import { NextResponse } from "next/server";

import { createJevClient, createNimChatClient, readAiServiceConfig } from "@/server/ai/clients";
import { authorizeTenantRequest } from "@/server/control-plane/tenant-context";
import { assertGitPermission } from "@/server/git/access-control";
import { gitErrorResponse, gitMeta } from "@/server/git/route-helpers";
import { resolveGitActorForTenant } from "@/server/git/runtime";

export const maxDuration = 60;

async function probe<T>(fn: () => Promise<T>) {
  const started = Date.now();
  try {
    return { ok: true, latencyMs: Date.now() - started, detail: await fn() };
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
    return NextResponse.json({ data, meta: gitMeta() }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return gitErrorResponse(error);
  }
}
