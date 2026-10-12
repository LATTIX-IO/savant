/**
 * Signed adapter-event trust boundary. No HTTP endpoint, no secret storage.
 * The credential resolver MUST bind active adapter keys to tenant and adapter.
 * All external calls are injected for testability and explicit fail-close.
 */
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { parseHarnessRunEvent } from "@savant/schemas/harness-adapter";

const ID=/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const TENANT=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SIGNATURE=/^v1=([a-f0-9]{64})$/;
const MAX_BYTES=8192, MAX_SKEW_SECONDS=300;
export class SignedHarnessEventError extends Error {
  readonly code:string;
  constructor(code:string){ super(code); this.name="SignedHarnessEventError"; this.code=code; }
}
function reject(code:string):never {throw new SignedHarnessEventError(code);}
export interface SignedHarnessEventEnvelope {
  tenantId:string; adapterId:string; runId:string; deliveryId:string;
  timestamp:string; signature:string; rawBody:Uint8Array;
}
export interface SignedHarnessEventDeps {
  nowMs:()=>number;
  resolveSecrets:(tenantId:string,adapterId:string)=>Promise<readonly Uint8Array[]>;
  getRun:(tenantId:string,runId:string)=>Promise<{
    tenantId:string;adapterId:string;runId:string;traceId:string;status:string;
  }>;
  applyEvent:(tenantId:string,runId:string,event:unknown,delivery:{deliveryId:string;payloadSha256:string})=>Promise<unknown>;
  /** Only install a tenant-authorized, durable metadata quarantine behind the signed verifier. */
  quarantine?:(input:{tenantId:string;adapterId:string;runId:string;deliveryId:string;payloadSha256:string;reason:"invalid_event"})=>Promise<unknown>;
}
export function createSignedHarnessEventAdmission(deps:SignedHarnessEventDeps){
  return async function admit(raw:SignedHarnessEventEnvelope):Promise<unknown>{
    if (!raw||typeof raw!=="object"||Array.isArray(raw)||
      typeof raw.tenantId!=="string"||!TENANT.test(raw.tenantId)||
      typeof raw.adapterId!=="string"||!ID.test(raw.adapterId)||
      typeof raw.runId!=="string"||!ID.test(raw.runId)||
      typeof raw.deliveryId!=="string"||!ID.test(raw.deliveryId)||
      typeof raw.timestamp!=="string"||!/^[1-9][0-9]{0,11}$/.test(raw.timestamp)||
      typeof raw.signature!=="string"||!SIGNATURE.test(raw.signature)||
      !(raw.rawBody instanceof Uint8Array)||
      raw.rawBody.byteLength<1||raw.rawBody.byteLength>MAX_BYTES)reject("unauthorized");
    // Snapshot untrusted bytes and framing fields before the first awaited operation.
    // No caller can rewrite the signed body, tenant or delivery identity mid-flight.
    const req = {
      tenantId: raw.tenantId, adapterId: raw.adapterId, runId: raw.runId,
      deliveryId: raw.deliveryId, timestamp: raw.timestamp, signature: raw.signature,
      rawBody: Buffer.from(raw.rawBody),
    };
    const now=deps.nowMs(),seconds=Number(req.timestamp);
    if(!Number.isSafeInteger(seconds)||!Number.isFinite(now)||
      Math.abs(seconds*1000-now)>MAX_SKEW_SECONDS*1000)reject("unauthorized");
    let secrets:readonly Uint8Array[];
    try {secrets=await deps.resolveSecrets(req.tenantId,req.adapterId);}
    catch {return reject("unauthorized");}
    if(!Array.isArray(secrets)||secrets.length<1||secrets.length>2)reject("unauthorized");
    const framing=Buffer.concat([
      Buffer.from(`savant-harness-v1\n${req.timestamp}\n${req.tenantId}\n${req.adapterId}\n${req.runId}\n${req.deliveryId}\n`,"utf8"),
      Buffer.from(req.rawBody),
    ]);
    const supplied=Buffer.from(req.signature.slice(3),"hex");
    let verified=false;
    for(const secret of secrets){
      if(!(secret instanceof Uint8Array)||secret.byteLength<32||secret.byteLength>128)
        reject("unauthorized");
      const expected=createHmac("sha256",secret).update(framing).digest();
      verified=timingSafeEqual(expected,supplied)||verified;
    }
    if(!verified)reject("unauthorized");
    // Only a signature-authenticated, tenant/adapter-owned run can create a
    // quarantine receipt. Unknown/foreign runs and invalid HMACs never reach it.
    let row:Awaited<ReturnType<SignedHarnessEventDeps["getRun"]>>;
    try{row=await deps.getRun(req.tenantId,req.runId);}
    catch{return reject("not_found");}
    if(!row||row.tenantId!==req.tenantId||row.adapterId!==req.adapterId||
      row.runId!==req.runId)reject("not_found");
    const payloadSha256=createHash("sha256").update(req.rawBody).digest("hex");
    async function invalidEvent():Promise<never>{
      if(deps.quarantine){
        try{
          await deps.quarantine({tenantId:req.tenantId,adapterId:req.adapterId,
            runId:req.runId,deliveryId:req.deliveryId,payloadSha256,reason:"invalid_event"});
        }catch{return reject("quarantine_unavailable");}
      }
      return reject("invalid_event");
    }
    let event:unknown;
    try{
      const body=new TextDecoder("utf-8",{fatal:true}).decode(req.rawBody);
      event=JSON.parse(body);
    }catch {return invalidEvent();}
    let parsed:ReturnType<typeof parseHarnessRunEvent>;
    try{parsed=parseHarnessRunEvent(event,{
      tenantId:req.tenantId,runId:req.runId,traceId:row.traceId,
    });}
    catch{return invalidEvent();}
    return deps.applyEvent(req.tenantId,req.runId,parsed,{deliveryId:req.deliveryId,payloadSha256});
  };
}
