import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {describeEnterpriseProviderPreflight} from "./enterprise-provider-catalog.ts";
const read=(p:string)=>readFileSync(fileURLToPath(new URL(p,import.meta.url)),"utf8");
test("PER-1608 all three ecosystems are catalogued but no consent is fabricated",()=>{
 const entries=describeEnterpriseProviderPreflight();
 assert.deepEqual(entries.map(p=>p.id),["openai","anthropic","microsoft"]);
 assert.ok(entries.every(p=>p.connectionState==="unconfigured"&&!p.grantVerified));
 assert.ok(entries.every(p=>p.surfaces.every(s=>!s.authorized&&!s.verified&&s.coverage==="unknown")));
 assert.ok(entries.every(p=>p.surfaces.length>=3));
 assert.ok(entries.every(p=>p.surfaces.every(s=>s.prerequisite.length>25)));
});
test("PER-1608 catalogue route checks tenant membership and cannot mutate provider consent",()=>{
 const route=read("../app/api/enterprise-ai/providers/route.ts");
 assert.match(route,/authorizeTenantRequest\(request\)/);
 assert.match(route,/!context.identity \|\| context.isDevelopmentFallback/);
 assert.doesNotMatch(route,/export async function POST|fetch\(|apiKey|token=|secret_ref|redirect\(/);
});
test("PER-1608 existing integration surface remains authoritative",()=>{
 const ui=read("../components/savant/screens/integrations-v2.tsx");
 assert.match(ui,/EnterpriseAIProviderPreflight/);
 assert.match(ui,/ProviderConnectionGuide/);
 assert.match(ui,/fetchAIConnections/);
 assert.doesNotMatch(ui,/oauth\/callback|sessionStorage|localStorage/);
});
