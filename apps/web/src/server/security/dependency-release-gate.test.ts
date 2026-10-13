import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";
import {parse as parseYaml} from "yaml";

const root=new URL("../../../../../",import.meta.url);
const webPackage=new URL("../../../package.json",import.meta.url);

async function readJson(url:URL):Promise<Record<string,unknown>>{
 return JSON.parse(await readFile(url,"utf8")) as Record<string,unknown>;
}
async function readYaml(url:URL):Promise<Record<string,unknown>>{
 return parseYaml(await readFile(url,"utf8")) as Record<string,unknown>;
}
function record(value:unknown):Record<string,unknown>{
 assert.ok(value&&typeof value==="object"&&!Array.isArray(value));
 return value as Record<string,unknown>;
}
test("PER-1409: MVP Next and ESLint paired patch is fully represented in the frozen lock",async()=>{
 const pkg=await readJson(webPackage);
 const dep=record(pkg.dependencies),dev=record(pkg.devDependencies);
 assert.equal(dep.next,"16.3.8");
 assert.equal(dev["eslint-config-next"],dep.next);
 const lock=await readYaml(new URL("pnpm-lock.yaml",root));
 const importer=record(record(lock.importers)["apps/web"]);
 const locked=record(record(importer.dependencies).next);
 const lint=record(record(importer.devDependencies)["eslint-config-next"]);
 assert.equal(locked.specifier,dep.next);
 assert.equal(lint.specifier,dev["eslint-config-next"]);
 assert.match(String(locked.version),/^16\.3\.8\(/);
 assert.match(String(lint.version),/^16\.3\.8\(/);
});
test("PER-1409: patched transitive production ranges are consistent with frozen pnpm resolutions",async()=>{
 const settings=await readYaml(new URL("pnpm-workspace.yaml",root));
 const lock=await readYaml(new URL("pnpm-lock.yaml",root));
 const wanted={
  "postcss":">=8.5.18 <9",
  "nanoid@3":">=3.3.18 <4",
  "browserslist":">=4.28.7 <5",
  "source-map-js":">=1.2.2 <2",
 };
 const actual=record(settings.overrides);
 const locked=record(lock.overrides);
 for(const [name,range] of Object.entries(wanted)){
  assert.equal(actual[name],range,`workspace override ${name}`);
  assert.equal(locked[name],range,`lockfile override ${name}`);
 }
 assert.equal(lock.lockfileVersion,"9.0");
});
test("PER-1409: Savant security scan cannot silently skip high/critical advisories",async()=>{
 const pkg=await readJson(new URL("package.json",root));
 const scripts=record(pkg.scripts);
 assert.equal(scripts["security:deps"],"pnpm audit --prod --audit-level high");
 const yml=await readFile(new URL(".github/workflows/savant-typescript.yml",root),"utf8");
 const job=yml.split("  dependency-audit:\n")[1]?.split("\n  workflow-postgres:\n")[0];
 assert.ok(job,"blocking production audit job must exist");
 assert.match(job,/pnpm install --frozen-lockfile/);
 assert.match(job,/name: Fail for high\/critical production advisories/);
 assert.match(job,/run: pnpm run security:deps/);
 assert.doesNotMatch(job,/continue-on-error:\s*true|exit\s+0|\|\|\s*true|--audit-level\s+(?:low|moderate)/);
});
