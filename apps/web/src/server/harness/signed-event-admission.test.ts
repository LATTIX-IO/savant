import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import test from "node:test";
import { createSignedHarnessEventAdmission, SignedHarnessEventError } from "./signed-event-admission.ts";

const key = Buffer.alloc(32, 0x41);
const rotated = Buffer.alloc(32, 0x42);
const tenantId = "11111111-1111-4111-8111-111111111111";
const otherTenant = "22222222-2222-4222-8222-222222222222";
const timestamp = "1791800000";
const event = { eventId:"evt-1", tenantId, runId:"run-1", traceId:"trace-1", sequence:1, status:"succeeded" };
const body = Buffer.from(JSON.stringify(event));
function envelope(overrides: Record<string,unknown> = {}) {
  const req = {
    tenantId, adapterId:"adapter-1", runId:"run-1", deliveryId:"delivery-1",
    timestamp, rawBody:body, signature:"", ...overrides,
  };
  const msg = Buffer.concat([
    Buffer.from(`savant-harness-v1\n${req.timestamp}\n${req.tenantId}\n${req.adapterId}\n${req.runId}\n${req.deliveryId}\n`),
    req.rawBody as Buffer,
  ]);
  req.signature = "v1=" + createHmac("sha256", key).update(msg).digest("hex");
  return req;
}
function fixture(options: {secret?: Uint8Array[], runAdapter?: string, runTenant?: string} = {}) {
  const io: string[] = [];
  const deps = {
    nowMs: () => Number(timestamp)*1000,
    resolveSecrets: async (_tenantId:string,_adapterId:string) => {
      io.push("resolve");
      return options.secret ?? [key];
    },
    getRun: async () => {
      io.push("read");
      return { tenantId:options.runTenant ?? tenantId,adapterId:options.runAdapter ?? "adapter-1",
        runId:"run-1", traceId:"trace-1",status:"running" };
    },
    applyEvent: async (_t:string,_r:string,e:unknown,delivery:{deliveryId:string;payloadSha256:string}) => {
      io.push("apply");
      assert.deepEqual(e,event);
      assert.deepEqual(delivery,{deliveryId:"delivery-1",payloadSha256:createHash("sha256").update(body).digest("hex")});
      return {status:"succeeded",replay:false};
    },
  };
  return {admit:createSignedHarnessEventAdmission(deps),io};
}
async function denied(code:string, fn:()=>Promise<unknown>) {
  await assert.rejects(fn,(e:unknown)=>e instanceof SignedHarnessEventError&&e.code===code);
}

test("PER-1059 signed ingress: verifies exact raw payload and trusted run attribution",async()=>{
  const f=fixture();
  const result=await f.admit(envelope());
  assert.deepEqual(result,{status:"succeeded",replay:false});
  assert.deepEqual(f.io,["resolve","read","apply"]);
});

test("PER-1059 signed ingress: tampered, invalid or expired signatures deny before run lookup",async()=>{
  const candidates=[
    {signature:"v1="+"0".repeat(64)}, {signature:"v1="+"a".repeat(63)},
    {signature:"garbage"}, {timestamp:"1791799000"}, {timestamp:"1791800900"},
    {timestamp:"0"},{deliveryId:"bad\nid"},{adapterId:"adapter-2"},
    {runId:"run-2"},{tenantId:otherTenant},
    {rawBody:Buffer.from(JSON.stringify({...event,status:"failed"}))},
    {rawBody:Buffer.alloc(8193)}, {rawBody:Buffer.alloc(0)}, {rawBody:"not-bytes"},
  ];
  for(const overrides of candidates){
    const f=fixture();
    const req=envelope();
    Object.assign(req,overrides);
    await denied("unauthorized",()=>f.admit(req));
    assert.ok(!f.io.includes("read")&&!f.io.includes("apply"));
  }
});

test("PER-1059 signed ingress: dual-key rotation, revoked or absent secret fail closed",async()=>{
  const rotatedEnvelope=envelope();
  const rotatedMessage=Buffer.concat([
    Buffer.from(`savant-harness-v1\n${timestamp}\n${tenantId}\nadapter-1\nrun-1\ndelivery-1\n`),body,
  ]);
  rotatedEnvelope.signature="v1="+createHmac("sha256",rotated).update(rotatedMessage).digest("hex");
  const f=fixture({secret:[rotated,key]});
  assert.deepEqual(await f.admit(rotatedEnvelope),{status:"succeeded",replay:false});
  const removed=fixture({secret:[key]});
  await denied("unauthorized",()=>removed.admit(rotatedEnvelope));
  const revoked=fixture({secret:[]});
  await denied("unauthorized",()=>revoked.admit(envelope()));
  assert.deepEqual(revoked.io,["resolve"]);
});

test("PER-1059 signed ingress: signed payload cannot graft to foreign run or adapter",async()=>{
  for(const opts of [{runTenant:otherTenant},{runAdapter:"foreign-adapter"}]){
    const f=fixture(opts);
    await denied("not_found",()=>f.admit(envelope()));
    assert.deepEqual(f.io,["resolve","read"]);
  }
});

test("PER-1059 signed ingress: signed malicious event fields and invalid UTF-8 fail before state mutation",async()=>{
  for(const payload of [
    {...event,rawPrompt:"secret"}, {...event,tenantId:otherTenant},
    {...event,traceId:"different"}, {...event,sequence:0}, {...event,status:"unknown"}, null,
  ]){
    const req=envelope({rawBody:Buffer.from(JSON.stringify(payload))});
    const f=fixture();
    await denied("invalid_event",()=>f.admit(req));
    assert.ok(!f.io.includes("apply"));
  }
  const malformed=envelope({rawBody:Buffer.from([0xff,0xfe])});
  const f=fixture();
  await denied("invalid_event",()=>f.admit(malformed));
  assert.ok(!f.io.includes("apply"));
});

test("PER-1059 signed ingress: no secret/body/provider data in errors",async()=>{
  const f=fixture();
  const req=envelope({rawBody:Buffer.from('{"api_key":"provider-secret"}')});
  await assert.rejects(()=>f.admit(req),(error:unknown)=>
    error instanceof SignedHarnessEventError&&error.message==="invalid_event");
});

test("PER-1059 signed ingress: invalid request performs no I/O",async()=>{
  const f=fixture();
  await denied("unauthorized",()=>f.admit(null as never));
  await denied("unauthorized",()=>f.admit({} as never));
  await denied("unauthorized",()=>f.admit({...envelope(),deliveryId:"x".repeat(200)}));
  assert.deepEqual(f.io,[]);
});

test("PER-1059: concurrent mutation cannot swap authenticated tenant, body or delivery ID",async()=>{
  const request=envelope({rawBody:Buffer.from(body)});
  const received:unknown[]=[];
  const admit=createSignedHarnessEventAdmission({
    nowMs:()=>Number(timestamp)*1000,
    async resolveSecrets(){
      request.tenantId=otherTenant;
      request.deliveryId="forged-delivery";
      (request.rawBody as Buffer).fill(0x58);
      return [key];
    },
    async getRun(t,r){
      assert.equal(t,tenantId);
      assert.equal(r,"run-1");
      return {tenantId,adapterId:"adapter-1",runId:"run-1",traceId:"trace-1",status:"running"};
    },
    async applyEvent(t,r,e,delivery){
      assert.equal(t,tenantId);
      assert.equal(r,"run-1");
      assert.deepEqual(e,event);
      received.push(delivery);
      return {status:"succeeded",replay:false};
    },
  });
  assert.deepEqual(await admit(request),{status:"succeeded",replay:false});
  assert.deepEqual(received,[{
    deliveryId:"delivery-1",
    payloadSha256:createHash("sha256").update(body).digest("hex"),
  }]);
});
