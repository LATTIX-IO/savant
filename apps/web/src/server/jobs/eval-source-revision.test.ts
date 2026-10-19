import assert from "node:assert/strict";
import test from "node:test";
import {requirePinnedEvaluationCommit,UnpinnedEvaluationSourceError} from "./eval-source-revision.ts";

test("MVP provenance: accepts only immutable full Git commit hashes",()=>{
 const sha1="a".repeat(40),sha256="b".repeat(64);
 assert.equal(requirePinnedEvaluationCommit(sha1),sha1);
 assert.equal(requirePinnedEvaluationCommit(sha256),sha256);
});
test("MVP provenance: rejects branch, tag, shortened hash and injection",()=>{
 for(const value of [null,undefined,"","main","refs/heads/main","v1.0.0",
   "abc1234","a".repeat(39),"a".repeat(65),"A".repeat(40),
   "../main","a".repeat(40)+"\n",{},17]){
  assert.throws(()=>requirePinnedEvaluationCommit(value),
   (error:unknown)=>error instanceof UnpinnedEvaluationSourceError);
 }
});
