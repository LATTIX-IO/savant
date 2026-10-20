import assert from "node:assert/strict";
import test from "node:test";
import {readBoundedTestBenchBody} from "./definition-request.ts";
import {TestBenchError} from "./definition-contract.ts";
const req=(body:string,type="application/json")=>
  new Request("https://example.com/api/test",{method:"POST",
    headers:{"content-type":type},body});
test("PER-1422: small JSON accepted after streaming and UTF-8 decode",async()=>{
 assert.deepEqual(await readBoundedTestBenchBody(req('{"value":1}')),{value:1});
});
test("PER-1422: no content type, invalid JSON and huge chunked bodies denied",async()=>{
 await assert.rejects(()=>readBoundedTestBenchBody(req("{}","text/plain")),TestBenchError);
 await assert.rejects(()=>readBoundedTestBenchBody(req("{invalid")),TestBenchError);
 await assert.rejects(()=>readBoundedTestBenchBody(req('{"content":"'+ "x".repeat(22000)+'"}')),
  (e:unknown)=>e instanceof TestBenchError&&e.code==="test_bench_request_too_large");
});
test("PER-1422: declared huge payload denied before reading body",async()=>{
 const request=new Request("https://example.com",{method:"POST",
   headers:{"content-type":"application/json","content-length":"50000"},body:"{}"});
 await assert.rejects(()=>readBoundedTestBenchBody(request),
  (e:unknown)=>e instanceof TestBenchError&&e.status===413);
});
