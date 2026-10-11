import type { CapabilityLinkV1, CapabilityReferenceV1, CapabilityRelation } from "@savant/types/capability-reference";
import { CapabilityReferenceError, canonicalizeCapabilityReference, parseCapabilityLink } from "@savant/schemas/capability-reference";
import { CapabilityResolveError, type CapabilityResolveActor, type createCapabilityResolver } from "./capability-resolver.ts";

type Resolver = Pick<ReturnType<typeof createCapabilityResolver>, "preflight" | "resolve">;
type VerifiedNode = { reference: CapabilityReferenceV1; verifiedDigest: string };
export type VerifiedLink = { relation: CapabilityRelation; from: VerifiedNode; to: VerifiedNode };
export type VerifiedLinksResult = { links: VerifiedLink[]; nodeCount: number };
const MAX_LINKS = 8;
const MAX_NODES = 12;
function invalid(): never { throw new CapabilityResolveError("invalid_link_batch", 422); }
function readLinks(input: unknown): CapabilityLinkV1[] {
  if (!input || typeof input !== "object" || Array.isArray(input) ||
    (Object.getPrototypeOf(input) !== Object.prototype && Object.getPrototypeOf(input) !== null)) invalid();
  const desc = Object.getOwnPropertyDescriptors(input);
  if (Object.keys(desc).length !== 1 || !desc.links || !("value" in desc.links)) invalid();
  const value: unknown = desc.links.value;
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_LINKS) invalid();
  if (Object.keys(value).length !== value.length) invalid();
  const links: CapabilityLinkV1[] = [];
  for (let index = 0; index < value.length; index++) {
    const item = Object.getOwnPropertyDescriptor(value, String(index));
    if (!item || !("value" in item)) invalid();
    try { links.push(parseCapabilityLink(item.value)); }
    catch (error) {
      if (error instanceof CapabilityReferenceError) invalid();
      throw error;
    }
  }
  return links;
}
function artifactIdentity(ref: CapabilityReferenceV1): string {
  const loc = ref.locator;
  return JSON.stringify([ref.organizationId, ref.kind, ref.artifactId, loc.source,
    loc.source === "git" ? loc.repositoryId : loc.recordId,
    loc.source === "git" ? loc.path : "",
    loc.source === "git" ? loc.commitSha : ""]);
}
/**
 * Checks EVERY referenced artifact's authorization before reading any content.
 * Results are atomic: no partial payload on denial, corruption or provider failure.
 * Returns hashes and identities only, never the sensitive source bodies.
 */
export function createCapabilityLinkService(resolver: Resolver) {
  return {
    async resolve(actor: CapabilityResolveActor, input: unknown): Promise<VerifiedLinksResult> {
      if (!actor.subject || !actor.organizationId) throw new CapabilityResolveError("auth_required", 401);
      const links = readLinks(input);
      const nodes = new Map<string, CapabilityReferenceV1>();
      const identityToKey = new Map<string, string>();
      // Parse and check every link *before* any SQL authorization or network operations.
      for (const link of links) {
        if (link.from.organizationId !== actor.organizationId || link.to.organizationId !== actor.organizationId)
          throw new CapabilityResolveError("not_found", 404);
        if (artifactIdentity(link.from) === artifactIdentity(link.to)) invalid();
        for (const ref of [link.from, link.to]) {
          if (ref.locator.source !== "git" || !["skill", "workflow_spec"].includes(ref.kind))
            throw new CapabilityResolveError("unsupported_kind", 409);
          if (!ref.contentHash) throw new CapabilityResolveError("provenance_incomplete", 409);
          const key = canonicalizeCapabilityReference(ref);
          const identity = artifactIdentity(ref);
          if (identityToKey.has(identity) && identityToKey.get(identity) !== key)
            throw new CapabilityResolveError("integrity_mismatch", 409);
          identityToKey.set(identity, key);
          nodes.set(key, ref);
        }
      }
      if (nodes.size > MAX_NODES) invalid();
      for (const ref of nodes.values()) await resolver.preflight(actor, ref);
      const verified = new Map<string, VerifiedNode>();
      for (const [key, ref] of nodes.entries()) {
        const proof = await resolver.resolve(actor, ref);
        verified.set(key, { reference: proof.reference, verifiedDigest: proof.verifiedDigest });
      }
      return {
        links: links.map(link => ({
          relation: link.relation,
          from: verified.get(canonicalizeCapabilityReference(link.from))!,
          to: verified.get(canonicalizeCapabilityReference(link.to))!,
        })),
        nodeCount: verified.size,
      };
    },
  };
}
