import type {ChatClient, ChatMessage, ChatResult, FetchLike} from "./clients.ts";

/** PER-1602: Native Anthropic API transport, not a Claude.ai/Claude Code OAuth
 * proxy. This helper is NOT wired to production or Test Bench until a separately
 * persisted provider-role grant and managed credential are verified at egress.
 */
export const ANTHROPIC_MESSAGES_ENDPOINT = "https://api.anthropic.com/v1/messages";
export const ANTHROPIC_API_VERSION = "2023-06-01";
const MAX_REQUEST_MS = 15_000;
const MAX_RESPONSE_BYTES = 32_768;

export class AnthropicMessagesError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(code);
    this.name = "AnthropicMessagesError";
    this.code = code;
  }
}
const reject = (code: string): never => { throw new AnthropicMessagesError(code); };
function tokens(v: unknown): v is number {
  return Number.isSafeInteger(v) && (v as number) >= 0;
}
function validUsage(value: unknown): {promptTokens: number; completionTokens: number} | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const u = value as Record<string, unknown>;
  if (!tokens(u.input_tokens) || !tokens(u.output_tokens)) return null;
  if (u.cache_creation_input_tokens !== undefined && !tokens(u.cache_creation_input_tokens)) return null;
  if (u.cache_read_input_tokens !== undefined && !tokens(u.cache_read_input_tokens)) return null;
  const input = (u.input_tokens as number) +
    (u.cache_creation_input_tokens as number | undefined ?? 0) +
    (u.cache_read_input_tokens as number | undefined ?? 0);
  const output = u.output_tokens as number;
  if (!Number.isSafeInteger(input) || !Number.isSafeInteger(input + output) ||
      input + output <= 0) return null;
  // Cache creation/read tokens are billable usage and must not be silently lost.
  return {promptTokens: input, completionTokens: output};
}
async function readBoundedResponse(response: Response): Promise<unknown> {
  const length = response.headers.get("content-length");
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_RESPONSE_BYTES))
    return reject("anthropic_transport_response_invalid");
  if (!response.body) return reject("anthropic_transport_response_invalid");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const {done, value} = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > MAX_RESPONSE_BYTES) return reject("anthropic_transport_response_invalid");
      chunks.push(value);
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {bytes.set(chunk, offset); offset += chunk.byteLength;}
    return JSON.parse(new TextDecoder("utf-8", {fatal: true}).decode(bytes)) as unknown;
  } catch (error) {
    if (error instanceof AnthropicMessagesError) throw error;
    return reject("anthropic_transport_response_invalid");
  } finally {
    reader.releaseLock();
  }
}

/** One billable attempt; hardcoded origin and version. Never log requests or
 * provider error bodies. Only a trusted server worker may construct this client.
 * It is not an authenticated role-binding API.
 */
export function createAnthropicMessagesClient(input: {
  model: string;
  apiKey: string;
  fetchImpl?: FetchLike;
}): ChatClient {
  const {model, apiKey, fetchImpl = fetch} = input;
  if (!model || model.length > 160 || !apiKey || apiKey.length > 400 ||
      /\s/.test(apiKey) || /\r|\n/.test(model))
    return reject("anthropic_transport_credential_invalid");
  return {
    model,
    async complete(messages: ChatMessage[], options = {}): Promise<ChatResult> {
      const maxTokens = options.maxTokens ?? 400;
      const timeoutMs = options.timeoutMs ?? MAX_REQUEST_MS;
      const temperature = options.temperature ?? 0.2;
      if (messages.length !== 2 || messages[0]?.role !== "system" ||
          messages[1]?.role !== "user" || messages.some(message =>
            !message.content || new TextEncoder().encode(message.content).length > 16_000) ||
          !Number.isSafeInteger(maxTokens) || maxTokens < 1 || maxTokens > 400 ||
          !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_REQUEST_MS ||
          !Number.isFinite(temperature) || temperature < 0 || temperature > 1 ||
          options.extraBody !== undefined)
        return reject("anthropic_transport_request_invalid");
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const started = Date.now();
      try {
        const response = await fetchImpl(ANTHROPIC_MESSAGES_ENDPOINT, {
          method: "POST", redirect: "error", credentials: "omit", cache: "no-store",
          headers: {
            authorization: `Bearer ${apiKey}`,
            "anthropic-version": ANTHROPIC_API_VERSION,
            "content-type": "application/json", accept: "application/json",
          },
          body: JSON.stringify({model, max_tokens: maxTokens,
            system: messages[0]!.content,
            messages: [{role: "user", content: messages[1]!.content}],
            temperature, stream: false}),
          signal: controller.signal,
        });
        if (!response.ok) return reject("anthropic_transport_http_failure");
        const parsed = await readBoundedResponse(response);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
          return reject("anthropic_transport_response_invalid");
        const body = parsed as Record<string, unknown>;
        const usage = validUsage(body.usage);
        if (body.type !== "message" || body.role !== "assistant" ||
            body.model !== model || !usage)
          return reject("anthropic_transport_response_invalid");
        const content = Array.isArray(body.content) ? body.content : null;
        const textBlock = content?.length === 1 && content[0] &&
          typeof content[0] === "object" && content[0].type === "text"
          ? content[0] as {text?: unknown} : null;
        const text = typeof textBlock?.text === "string" ? textBlock.text.trim() : "";
        const usable = body.stop_reason === "end_turn" && !!text && text.length <= 3_000;
        if (!usable && !options.usageEvidenceMode)
          return reject("anthropic_transport_response_invalid");
        return {
          content: usable ? text : "", model, latencyMs: Date.now() - started,
          usage, finishReason: body.stop_reason === "end_turn" ? "stop" :
            typeof body.stop_reason === "string" ? body.stop_reason : null,
          reasoningChars: 0,
        };
      } catch (error) {
        if (error instanceof AnthropicMessagesError) throw error;
        return reject("anthropic_transport_request_failed");
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
