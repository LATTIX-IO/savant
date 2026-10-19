# PER-1453 — Test Bench single-attempt transports and usage-first failure evidence

## Defect and impact
The shared platform NIM/Jev `postJson` implementation defaults to four attempts on 408/429/5xx, transport failures and response decode failures. Test Bench's durable per-run lease retry denial does **not** prevent those automatic retries inside one provider call. A timeout after remote execution can thus create multiple provider side effects without additional admission. Separately, concrete NIM/Jev and tenant OpenAI clients can discard returned usage before the evaluator's `onUsage` callback if the response has an empty completion, truncated/filtered finish, or incomplete judge answers. Provider charge reconciliation cannot assume missing ACK means zero incurred spend.

## Threat controls
- Provider calls selected by `runObservedTestBenchJob` use `singleAttempt:true` on both NIM and Jev constructors, even when the executor is a tenant-owned OpenAI connection. The first-party tenant OpenAI constructor already uses one fixed-origin HTTPS request without retries. Other generation workflows preserve their previous transport policy.
- The common transport now sets `redirect:error`, `credentials:omit`, `cache:no-store`. It never sleeps after its last failed attempt.
- `usageEvidenceMode` is opt-in **only** on the server-evaluation adapter call. NIM/Jev return a bounded response containing provider-reported usage even if text/answers are invalid; normal consumers stay strict.
- Tenant OpenAI verifies exact pinned model and positive integer usage before allowing evidence mode; filtered, truncated, tool-routed, missing, or oversized model output becomes empty/unusable content. No untrusted tool call, partial text, or positive pass result can bypass the evaluator.
- Evaluator persists the genuine positive provider usage ACK before enforcing usable executor output, successful `finishReason='stop'`, and complete Jev verdicts. An ACK callback failure prevents additional external calls. The prior transactionally enforced case+phase receipts and score publication gate remain authoritative.
- Unknown HTTP/timeout side effects are not estimated as zero. No refund, retry, provider invoice, actual-dollar spend cap, or user-visible raw model response is introduced.

## Acceptance evidence
- `provider-transport-evidence.test.ts`: mocked real NIM/Jev HTTP adapters validate exactly one request on HTTP 408/429/503, network exception and malformed JSON; no redirects/credentials forwarding; opt-in usage counts on bad provider results; no judge after bad executor; no score after bad judge; no receipt for invalid token counts.
- `tenant-openai-client.test.ts`: legitimate usage survives invalid OpenAI output but normal mode stays strict, and forged model/usage never creates trusted evidence.
- `verify-observed-provider-usage.mjs`: isolated PostgreSQL worker with concrete mocked HTTP adapters verifies failed run retains executor-only or executor+judge usage counters and 0 score while redacted logs/audit/queue contain no secrets or unusable outputs.
- Inherited negative regression: tenant authorization, encryption, race/admission quotas, cancellation, unsafe lease recovery, pinned source comparison.
- Exact-head `pnpm test`, `pnpm lint`, `pnpm typecheck`, `pnpm build`, committed-secret scan, high/critical dependency audit, PostgreSQL migrations applied twice and tests are required before review; Vercel READY, independent review, managed encryption keys and authenticated real-provider smoke remain external release gates.

## Deployment
Keep draft and stacked on #77 until gates complete. This is risk containment for billable calls, **not** verified monetary settlement. Parent PER-1441 remains open for versioned pricing, invoice reconciliation, entitlements, and uncertain side-effect accounting. No API route/schema/public UI changes, and no new production secrets.
