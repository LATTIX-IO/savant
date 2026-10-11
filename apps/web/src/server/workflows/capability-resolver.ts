import type { CapabilityReferenceV1 } from "@savant/types/capability-reference";
import { CapabilityReferenceError, parseCapabilityReference } from "@savant/schemas/capability-reference";

/** Read-only proof of an artifact. Reference parsing is not an authorization grant. */
export class CapabilityResolveError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, status: number) {
    super(code);
    this.name="CapabilityResolveError";
    this.code=code;
    this.status=status;
  }
}
export type CapabilityResolveActor={organizationId:string;subject:string};
export interface CapabilityResolverPorts {
  /** Authorize actor, repository AND artifact without accessing any provider. */
  authorize(actor:CapabilityResolveActor,reference:CapabilityReferenceV1):Promise<void>;
  /** Must read the pinned revision with the managed read-scoped provider broker. */
  workflow(actor:CapabilityResolveActor,reference:CapabilityReferenceV1):Promise<{
    specification:{workflowId:string;version:string};
    digest:string;commitSha:string;
  }>;
  /** Must check tenant/indexed skill ID/path/version/commit before pinned provider read. */
  skill(actor:CapabilityResolveActor,reference:CapabilityReferenceV1):Promise<{
    content:string;commitSha:string;
  }>;
}
export type CapabilityResolved =
  | {kind:"workflow_spec";reference:CapabilityReferenceV1;specification:Awaited<ReturnType<CapabilityResolverPorts["workflow"]>>["specification"];verifiedDigest:string}
  | {kind:"skill";reference:CapabilityReferenceV1;content:string;verifiedDigest:string};

const MAX_BYTES=512_000;
function integrity():never{throw new CapabilityResolveError("integrity_mismatch",409);}
export function createCapabilityResolver(ports:CapabilityResolverPorts){
  return {
    async resolve(actor:CapabilityResolveActor,untrusted:unknown):Promise<CapabilityResolved>{
      if(!actor.subject||!actor.organizationId)throw new CapabilityResolveError("auth_required",401);
      let ref:CapabilityReferenceV1;
      try{ref=parseCapabilityReference(untrusted);}
      catch(e){if(e instanceof CapabilityReferenceError)throw new CapabilityResolveError("invalid_reference",422);throw e;}
      if(ref.organizationId!==actor.organizationId)throw new CapabilityResolveError("not_found",404);
      if(ref.locator.source!=="git"||!["workflow_spec","skill"].includes(ref.kind))throw new CapabilityResolveError("unsupported_kind",409);
      if(!ref.contentHash)throw new CapabilityResolveError("provenance_incomplete",409);
      if(ref.kind==="workflow_spec"&&ref.locator.path!==`workflows/${ref.artifactId}.json`)throw new CapabilityResolveError("locator_mismatch",422);
      // Always authorize before reading the pinned bytes (not even a metadata probe).
      try{await ports.authorize(actor,ref);}
      catch(e){if(e instanceof CapabilityResolveError)throw e;throw new CapabilityResolveError("not_found",404);}
      const expected=ref.contentHash.toLowerCase();
      try{
        if(ref.kind==="workflow_spec"){
          const doc=await ports.workflow(actor,ref);
          if(doc.commitSha.toLowerCase()!==ref.locator.commitSha.toLowerCase()||
            doc.specification.workflowId!==ref.artifactId||doc.specification.version!==ref.version||
            "sha256:"+doc.digest.toLowerCase()!==expected)integrity();
          return {kind:"workflow_spec",reference:ref,specification:doc.specification,verifiedDigest:expected};
        }
        const doc=await ports.skill(actor,ref);
        if(doc.commitSha.toLowerCase()!==ref.locator.commitSha.toLowerCase())integrity();
        const bytes=new TextEncoder().encode(doc.content);
        if(bytes.byteLength>MAX_BYTES)throw new CapabilityResolveError("content_oversized",413);
        const digest=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",bytes)),b=>b.toString(16).padStart(2,"0")).join("");
        if("sha256:"+digest!==expected)integrity();
        return {kind:"skill",reference:ref,content:doc.content,verifiedDigest:expected};
      }catch(e){
        if(e instanceof CapabilityResolveError)throw e;
        throw new CapabilityResolveError("provider_unavailable",503);
      }
    },
  };
}
