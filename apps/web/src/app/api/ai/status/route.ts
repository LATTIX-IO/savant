import { NextResponse } from "next/server";

import { createJevClient, createNimChatClient, readAiServiceConfig } from "@/server/ai/clients";
import { authorizeTenantRequest } from "@/server/control-plane/tenant-context";
import { assertGitPermission } from "@/server/git/access-control";
import { gitErrorResponse, gitMeta } from "@/server/git/route-helpers";
import { resolveGitActorForTenant } from "@/server/git/runtime";

export const maxDuration = 300;

async function probe<T>(fn: () => Promise<T>) {
  const started = Date.now();
  try {
    const detail = await fn();
    return { ok: true, latencyMs: Date.now() - started, detail };
  } catch (error) {
    return { ok: false, latencyMs: Date.now() - started, detail: error instanceof Error ? error.message.slice(0, 300) : String(error) };
  }
}

/** Which platform AI services are configured; `?ping=1` (admins) makes one tiny call to each. */
export async function GET(request: Request) {
  try {
    const context = await authorizeTenantRequest(request);
    const actor = await resolveGitActorForTenant(context);
    const config = readAiServiceConfig();
    const data: Record<string, unknown> = {
      nim: config.nim ? { configured: true, generationModel: config.nim.generationModel, executionModel: config.nim.executionModel } : { configured: false },
      jev: config.jev ? { configured: true, model: config.jev.model } : { configured: false },
      sandbox: { enabled: process.env.SKILLSPECTOR_ENABLED !== "0", llmMode: process.env.SKILLSPECTOR_LLM ?? "flagged" },
    };
    if (new URL(request.url).searchParams.get("ping") === "1") {
      assertGitPermission(actor, "connect_provider");
      const nim = config.nim;
      const jev = config.jev;
      data.ping = {
        nim: nim ? await probe(async () => {
          const result = await createNimChatClient(nim, nim.generationModel).complete([{ role: "user", content: "Reply with the single word: ready" }], { maxTokens: 400, temperature: 0, timeoutMs: 45_000 });
          return { model: result.model, reply: result.content.slice(0, 40), latencyMs: result.latencyMs };
        }) : null,
        jev: jev ? await probe(async () => {
          const result = await createJevClient(jev).ask("The deployment failed and customers cannot log in.", {
            urgent: { type: "noul", instructions: "Does this describe an urgent production problem?", criteria: { true: "Urgent", false: "Not urgent" } },
          }, { timeoutMs: 30_000 });
          return { model: result.model, answer: result.answers.urgent, latencyMs: result.latencyMs };
        }) : null,
      };
    }
    // `?probe=draft` (admins): a drafting-sized request with and without reasoning, to tune NIM settings.
    if (new URL(request.url).searchParams.get("probe") === "draft" && config.nim) {
      assertGitPermission(actor, "connect_provider");
      const nim = config.nim;
      const client = createNimChatClient(nim, nim.generationModel);
      const prompt = [
        "Write 6 evaluation cases for an agent skill that reviews AI-generated drafts and decides whether to continue, label uncertainty, escalate to a human, or abstain.",
        'Respond with JSON only: {"cases":[{"kind":"positive|edge|negative|escalation","prompt":"...","context":"...","expected_behavior":"..."}]}',
      ].join("\n");
      const variants: Array<[string, Record<string, unknown>, string]> = [
        ["default", {}, "You write evaluation cases. Answer with JSON only."],
        ["enable_thinking_false", { chat_template_kwargs: { enable_thinking: false } }, "You write evaluation cases. Answer with JSON only."],
        ["no_think_system", {}, "/no_think\nYou write evaluation cases. Answer with JSON only."],
      ];
      data.probe = Object.fromEntries(await Promise.all(variants.map(async ([name, extraBody, system]) => [name, await probe(async () => {
        const result = await client.complete([{ role: "system", content: system }, { role: "user", content: prompt }], { maxTokens: 3000, temperature: 0.7, timeoutMs: 240_000, extraBody });
        return { finishReason: result.finishReason, reasoningChars: result.reasoningChars, contentChars: result.content.length, completionTokens: result.usage.completionTokens, latencyMs: result.latencyMs };
      })])));
    }
    return NextResponse.json({ data, meta: gitMeta() }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return gitErrorResponse(error);
  }
}
