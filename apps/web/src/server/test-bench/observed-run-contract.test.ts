import assert from "node:assert/strict";
import test from "node:test";
import {parseObservedRunAdmission} from "./observed-run-contract.ts";
import {TestBenchError} from "./definition-contract.ts";
const requestId="97ee557d-3dc0-4ee1-af29-72fedc58e4d7";
test("PER-1425: only a valid idempotency key and exact saved revision may start real provider execution",()=>{
 assert.deepEqual(parseObservedRunAdmission({requestId,expectedRevision:1}),
   {requestId,expectedRevision:1});
 for(const candidate of [
  null,[],{}, {requestId,expectedRevision:0},
  {requestId,expectedRevision:"1"},{requestId:"main",expectedRevision:1},
  {requestId,expectedRevision:1,provider:"attacker-controlled"},
  {requestId,expectedRevision:1,sourceCommitSha:"a".repeat(40)},
  {requestId,expectedRevision:1,requestBody:{command:"sh"}},
  {requestId,expectedRevision:1,toolExecution:true},
  {requestId,expectedRevision:1,cases:[{prompt:"untrusted"}]},
 ])assert.throws(()=>parseObservedRunAdmission(candidate),TestBenchError);
});
