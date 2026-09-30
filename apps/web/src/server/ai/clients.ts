/**
 * Platform AI services used by evaluation generation and safety scanning:
 *
 * - NVIDIA NIM (OpenAI-compatible chat completions) is the generative model:
 *   it drafts evaluation cases and executes skills against them.
 * - TypeSafe Jev is the System One judge: it validates drafted cases and
 *   scores outputs, returning typed answers with calibrated probabilities.
 *
 * Keys are platform environment variables and stay server-side.
 */

export type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

type Env = Record<string, string | undefined>;

export const DEFAULT_NIM_BASE_URL = "https://integrate.api.nvidia.com/v1";
export const DEFAULT_NIM_MODEL = "nvidia/nemotron-3-super-120b-a12b";
export const DEFAULT_JEV_BASE_URL = "https://api.typesafe.ai/v1";
export const DEFAULT_JEV_MODEL = "jev-latest";

export class AiServiceError extends Error {
  readonly service: "nim" | "jev";
  readonly status: number | null;

  constructor(service: "nim" | "jev", message: string, status: number | null = null) {
    super(message);
    this.name = "AiServiceError";
    this.service = service;
    this.status = status;
  }
}

export type AiServiceConfig = {
  nim: { apiKey: string; baseUrl: string; generationModel: string; executionModel: string; extraBody: Record<string, unknown> } | null;
  jev: { apiKey: string; baseUrl: string; model: string } | null;
};

/** Optional JSON merged into NIM requests (e.g. `{"chat_template_kwargs":{"enable_thinking":false}}`). */
// Nemotron 3 reasons by default; for drafting and executing cases that costs
// 2-3x the latency and can exhaust max_tokens before the answer is written.
export const DEFAULT_NIM_EXTRA_BODY = { chat_template_kwargs: { enable_thinking: false } };

function parseExtraBody(value: string | undefined): Record<string, unknown> {
  if (value === undefined) return DEFAULT_NIM_EXTRA_BODY;
  if (!value.trim()) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

export function readAiServiceConfig(env: Env = process.env): AiServiceConfig {
  const nimKey = env.NVIDIA_NIM_API_KEY?.trim();
  const jevKey = env.JEV_API_KEY?.trim();
  const generationModel = env.NIM_GENERATION_MODEL?.trim() || DEFAULT_NIM_MODEL;
  return {
    nim: nimKey
      ? {
          apiKey: nimKey,
          baseUrl: (env.NIM_BASE_URL?.trim() || DEFAULT_NIM_BASE_URL).replace(/\/+$/, ""),
          generationModel,
          executionModel: env.NIM_EXECUTION_MODEL?.trim() || generationModel,
          extraBody: parseExtraBody(env.NIM_EXTRA_BODY),
        }
      : null,
    jev: jevKey
      ? {
          apiKey: jevKey,
          baseUrl: (env.JEV_BASE_URL?.trim() || DEFAULT_JEV_BASE_URL).replace(/\/+$/, ""),
          model: env.JEV_MODEL?.trim() || DEFAULT_JEV_MODEL,
        }
      : null,
  };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function postJson(
  service: "nim" | "jev",
  fetchImpl: FetchLike,
  url: string,
  apiKey: string,
  body: unknown,
  timeoutMs: number,
  attempts = 4,
): Promise<unknown> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url, {
        method: "POST",
        headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (response.ok) {
        return await response.json();
      }
      const text = (await response.text().catch(() => "")).slice(0, 300);
      const error = new AiServiceError(service, `${service === "nim" ? "NVIDIA NIM" : "Jev"} returned ${response.status}${text ? `: ${text}` : ""}`, response.status);
      // Retry rate limits, overload and transient server errors; fail fast otherwise.
      if (![408, 429, 500, 502, 503, 504, 529].includes(response.status)) {
        throw error;
      }
      lastError = error;
    } catch (error) {
      if (error instanceof AiServiceError && ![408, 429, 500, 502, 503, 504, 529].includes(error.status ?? 0)) {
        throw error;
      }
      lastError = error instanceof AiServiceError
        ? error
        : new AiServiceError(service, `${service === "nim" ? "NVIDIA NIM" : "Jev"} request failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      clearTimeout(timer);
    }
    await sleep(Math.min(8000, 500 * 2 ** attempt) + Math.floor(Math.random() * 250));
  }
  throw lastError instanceof Error ? lastError : new AiServiceError(service, "Request failed.");
}

// ── NVIDIA NIM ──────────────────────────────────────────────────────────

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export type ChatResult = {
  content: string;
  model: string;
  latencyMs: number;
  usage: { promptTokens: number; completionTokens: number };
  finishReason: string | null;
  reasoningChars: number;
};

export type ChatClient = {
  readonly model: string;
  complete(messages: ChatMessage[], options?: { maxTokens?: number; temperature?: number; timeoutMs?: number; extraBody?: Record<string, unknown> }): Promise<ChatResult>;
};

/** Removes reasoning traces some NIM models emit before the answer. */
export function stripReasoning(content: string): string {
  return content.replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/^[\s\S]*?<\/think>/i, "").trim();
}

export function createNimChatClient(
  config: NonNullable<AiServiceConfig["nim"]>,
  model: string,
  fetchImpl: FetchLike = fetch,
): ChatClient {
  return {
    model,
    async complete(messages, options = {}) {
      const started = Date.now();
      const data = await postJson("nim", fetchImpl, `${config.baseUrl}/chat/completions`, config.apiKey, {
        model,
        messages,
        max_tokens: options.maxTokens ?? 1500,
        temperature: options.temperature ?? 0.4,
        top_p: 0.95,
        stream: false,
        ...config.extraBody,
        ...options.extraBody,
      }, options.timeoutMs ?? 120_000) as {
        model?: string;
        choices?: Array<{ finish_reason?: string | null; message?: { content?: string | null; reasoning_content?: string | null } }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      const choice = data.choices?.[0];
      const message = choice?.message;
      const content = stripReasoning(message?.content ?? "");
      if (!content) {
        throw new AiServiceError("nim", `NVIDIA NIM returned an empty completion (finish reason: ${choice?.finish_reason ?? "unknown"}${message?.reasoning_content ? `, ${message.reasoning_content.length} characters of reasoning` : ""}).`, 422);
      }
      return {
        content,
        model: data.model ?? model,
        latencyMs: Date.now() - started,
        usage: { promptTokens: data.usage?.prompt_tokens ?? 0, completionTokens: data.usage?.completion_tokens ?? 0 },
        finishReason: choice?.finish_reason ?? null,
        reasoningChars: message?.reasoning_content?.length ?? 0,
      };
    },
  };
}

/** Extracts the first JSON object or array from model output (tolerates code fences and prose). */
export function extractJson(content: string): unknown {
  const text = stripReasoning(content).replace(/```(?:json)?/gi, "");
  const starts = [text.indexOf("{"), text.indexOf("[")].filter((index) => index >= 0);
  if (starts.length === 0) {
    throw new AiServiceError("nim", "The model did not return JSON.");
  }
  const start = Math.min(...starts);
  const open = text[start];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (char === "\\") index += 1;
      else if (char === "\"") inString = false;
      continue;
    }
    if (char === "\"") inString = true;
    else if (char === open) depth += 1;
    else if (char === close) {
      depth -= 1;
      if (depth === 0) {
        return JSON.parse(text.slice(start, index + 1));
      }
    }
  }
  throw new AiServiceError("nim", "The model returned incomplete JSON.");
}

// ── TypeSafe Jev ────────────────────────────────────────────────────────

export type JevQuestion =
  | { type: "noul"; instructions: unknown; criteria: { true: unknown; false: unknown } }
  | { type: "choice"; instructions: unknown; criteria: Record<string, unknown> }
  | { type: "score"; instructions: unknown; criteria: unknown[] };

export type JevAnswer =
  | { type: "noul"; noul: number }
  | { type: "choice"; choice: string; probabilities: Record<string, number>; confidence: number }
  | { type: "score"; score: number; probabilities: Record<string, number>; confidence: number; legend?: Record<string, unknown> };

export type JevResult = {
  model: string;
  answers: Record<string, JevAnswer>;
  usage: { inputTokens: number; outputTokens: number };
  latencyMs: number;
};

export type JudgeClient = {
  readonly model: string;
  ask(state: unknown, questions: Record<string, JevQuestion>, options?: { timeoutMs?: number }): Promise<JevResult>;
};

export function createJevClient(config: NonNullable<AiServiceConfig["jev"]>, fetchImpl: FetchLike = fetch): JudgeClient {
  return {
    model: config.model,
    async ask(state, questions, options = {}) {
      const started = Date.now();
      const data = await postJson("jev", fetchImpl, `${config.baseUrl}/systemone`, config.apiKey, {
        model: config.model,
        state,
        questions,
      }, options.timeoutMs ?? 60_000) as { model?: string; answers?: Record<string, JevAnswer>; usage?: { input_tokens?: number; output_tokens?: number } };
      const answers = data.answers ?? {};
      for (const id of Object.keys(questions)) {
        if (!answers[id]) {
          throw new AiServiceError("jev", `Jev did not answer "${id}".`);
        }
      }
      return {
        model: data.model ?? config.model,
        answers,
        usage: { inputTokens: data.usage?.input_tokens ?? 0, outputTokens: data.usage?.output_tokens ?? 0 },
        latencyMs: Date.now() - started,
      };
    },
  };
}

export const noulOf = (answer: JevAnswer | undefined): number => (answer?.type === "noul" ? answer.noul : 0);
export const scoreOf = (answer: JevAnswer | undefined): number => (answer?.type === "score" ? answer.score : 0);
export const choiceOf = (answer: JevAnswer | undefined): { choice: string; confidence: number; probabilities: Record<string, number> } =>
  answer?.type === "choice" ? answer : { choice: "", confidence: 0, probabilities: {} };
