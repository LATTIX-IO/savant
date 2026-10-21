import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
const read=(p:string)=>readFileSync(fileURLToPath(new URL(p,import.meta.url)),"utf8");
const guide=read("../components/savant/screens/provider-connection-guide.tsx");
const integrations=read("../components/savant/screens/integrations-v2.tsx");
const settings=read("../components/savant/screens/settings-v2.tsx");
const css=read("../components/savant/screens/operational-admin-v2.module.css");
test("PER-1607: UI distinguishes test execution, production serving and organization connectors",()=>{
 for(const label of ["Test inference provider","Production / enterprise inference provider",
  "Enterprise connectors and organization telemetry","Developer notes","PER-1602","PER-1603"])
  assert.ok(guide.includes(label),label);
 assert.match(guide,/not automatically grant Savant API inference/);
 assert.match(guide,/different\s+from Savant calling the provider for inference/);
 assert.match(guide,/adr-0025-enterprise-provider-connection-boundaries/);
});
test("PER-1607: pending account and enterprise controls cannot issue OAuth or provider calls",()=>{
 const buttons=[...guide.matchAll(/<button type="button" disabled/g)];
 assert.equal(buttons.length,4);
 for(const name of ["Continue with ChatGPT","Connect Claude Code runtime",
  "Connect enterprise inference","Authorize enterprise workspace"])
  assert.ok(guide.includes(name));
 assert.doesNotMatch(guide,/fetch\(|onClick=|localStorage|sessionStorage|oauth\/authorize/);
 assert.match(integrations,/testAction=\{<Link href=\{modelsHref\}/);
 assert.match(settings,/onClick=\{\(\)=>setTab\("advanced"\)\}/);
});
test("PER-1607: reused central v2 tokens and both existing screen routes",()=>{
 assert.match(integrations,/ProviderConnectionGuide/);
 assert.match(settings,/\["ai","AI providers"\]/);
 assert.match(settings,/inspectUiV2ProviderLanes\(settings\.aiConnections\)/);
 assert.match(guide,/UiV2Status/);
 assert.match(css,/\.providerGuideGrid/);
 assert.match(css,/@media\(max-width:900px\)/);
});
