import {createHash, timingSafeEqual} from "node:crypto";
import type {ChatClient, ChatMessage, ChatResult, FetchLike} from "./clients.ts";
import {createAnthropicMessagesClient} from "./anthropic-messages.ts";
import {assertProviderRoleAdmission, ProviderRoleAdmissionError,
  type ProviderRoleActor, type ProviderRoleConnection, type ProviderRoleGrant,
  type ProviderRoleInvocation} from "../control-plane/provider-role-admission.ts";

/** All snapshot properties must come from the authoritative server-side store.
 * Do not expose this function in an HTTP route accepting client-supplied grants.
 */
export type AnthropicEvaluationAuthority = Readonly<{
  actor: ProviderRoleActor | null;
  connection: ProviderRoleConnection | null;
  grant: ProviderRoleGrant | null;
  intent: ProviderRoleInvocation;
}>;

/** PER-1602: Egress-bound role verification for future Anthropic Test Bench.
 * Refreshes actor membership, grant, model, key version, cost and budget for
 * EACH paid provider call. This is not yet wired to the production job worker.
 */
export function createRoleBoundAnthropicEvaluationClient(input: {
  model: string;
  apiKey: string;
  loadAuthority: () => Promise<AnthropicEvaluationAuthority>;
  fetchImpl?: FetchLike;
}): ChatClient {
  const client = createAnthropicMessagesClient(input);
  return {
    model: client.model,
    async complete(messages: ChatMessage[], options = {}): Promise<ChatResult> {
      let state: AnthropicEvaluationAuthority;
      try { state = await input.loadAuthority(); }
      catch { throw new ProviderRoleAdmissionError("provider_grant_authority_unavailable"); }
      const admission = assertProviderRoleAdmission({
        ...state,
        supportedCredentialModes: ["api-key"],
      });
      if (admission.role !== "evaluation-executor" ||
          admission.provider !== "anthropic" || admission.model !== client.model)
        throw new ProviderRoleAdmissionError("provider_grant_role_unavailable");
      // Do not trust stored metadata alone: bind the EXACT decrypted API key
      // about to be transmitted to the admission-time fingerprint.
      const actual = createHash("sha256").update(input.apiKey.trim(), "utf8").digest();
      const expected = Buffer.from(admission.secretFingerprint, "hex");
      if (expected.length !== actual.length || !timingSafeEqual(actual, expected))
        throw new ProviderRoleAdmissionError("provider_grant_credential_changed");
      return client.complete(messages, options);
    },
  };
}
