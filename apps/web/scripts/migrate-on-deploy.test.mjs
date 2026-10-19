import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import test from "node:test";
import path from "node:path";

const script=fileURLToPath(new URL("./migrate-on-deploy.mjs",import.meta.url));
const safeEnv={PATH:process.env.PATH??"",SystemRoot:process.env.SystemRoot??""};
function call(extra){
  return spawnSync(process.execPath,[script],{
    env:{...safeEnv,...extra},
    cwd:path.resolve(path.dirname(script),".."),
    encoding:"utf8",timeout:10000
  });
}
test("PER-1556: production Vercel build never executes schema DDL without recovered staging",()=>{
  for(const flag of [undefined,"1","true"]){
    const env={VERCEL_ENV:"production",DATABASE_URL:"postgresql://example.invalid/no-touch"};
    if(flag!==undefined)env.SAVANT_MIGRATE_ON_BUILD=flag;
    const r=call(env);
    assert.equal(r.status,0);
    assert.equal(r.stderr.trim(),"");
    assert.match(r.stdout,/Production schema migration is disabled during builds/);
    assert.doesNotMatch(r.stdout,/Applying db\/schema|Schema is up to date/);
  }
});
test("PER-1556: preview and unspecified Vercel builds skip schema DDL by default",()=>{
  for(const mode of ["preview","development",""]){
    const r=call({VERCEL_ENV:mode,DATABASE_URL:"postgresql://example.invalid/no-touch"});
    assert.equal(r.status,0);
    assert.match(r.stdout,/explicit nonproduction opt-in absent/);
    assert.doesNotMatch(r.stdout,/Applying db\/schema/);
  }
});
test("PER-1556: explicit nonproduction migration still fails closed without a database",()=>{
  const r=call({VERCEL_ENV:"preview",SAVANT_MIGRATE_ON_BUILD:"1"});
  assert.equal(r.status,1);
  assert.match(r.stderr,/No DATABASE_URL is available/);
  assert.doesNotMatch(r.stdout+r.stderr,/postgresql:\/\//);
});
