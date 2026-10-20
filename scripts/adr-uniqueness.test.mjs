import assert from "node:assert/strict";
import test from "node:test";
import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const architecture = path.join(root, "docs", "architecture");

test("architecture decision record numbers are unique across independent workstreams", () => {
  const files = readdirSync(architecture).filter(name => /^adr-\d{4}-.*\.md$/i.test(name));
  const grouped = new Map();
  for (const file of files) {
    const number = /^adr-(\d{4})-/.exec(file.toLowerCase())?.[1];
    assert.ok(number, "ADR filenames must have a canonical numeric prefix");
    grouped.set(number, [...(grouped.get(number) || []), file]);
  }
  const repeated = [...grouped.entries()]
    .filter(([, names]) => names.length > 1)
    .map(([number, names]) => "ADR-" + number + ": " + names.join(", "));
  assert.deepEqual(repeated, [],
    "Duplicate ADR numbers confuse future architecture source-of-truth links");
});
