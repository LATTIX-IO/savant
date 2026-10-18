import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";

const source=readFileSync(new URL("../docs/architecture/adr-0003-harness-adapter-protocol.md",import.meta.url),"utf8");

test("PER-1057: protocol ADR preserves readable Markdown code spans across stacked branches",()=>{
  assert.doesNotMatch(source,/\\`/,"Do not publish escaped literal Markdown delimiters in the adapter ADR");
  for(const symbol of [
    "`@savant/types/harness-adapter`",
    "`@savant/schemas/harness-adapter`",
    "`HarnessAdapter`",
    "`createHarnessGateway`",
  ]){
    assert.ok(source.includes(symbol),"Missing typed API code span "+symbol);
  }
  assert.match(source,/No production route, migration or deployment wiring is introduced\./);
});
