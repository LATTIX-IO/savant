import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";

const classic=readFileSync(fileURLToPath(new URL("../components/savant/screens/settings.tsx",import.meta.url)),"utf8");
const v2=readFileSync(fileURLToPath(new URL("../components/savant/screens/settings-v2.tsx",import.meta.url)),"utf8");
const between=(start:string,end:string)=>classic.slice(classic.indexOf(start),classic.indexOf(end));
test("PER-1606: classic advanced Auth0 panel cannot claim fabricated SCIM synchronization",()=>{
 const auth=between("function AuthSection(", "function AIProvidersSection(");
 assert.match(auth,/Provider-backed SCIM synchronization is not configured/);
 assert.match(auth,/No last-sync timestamp, group membership, or effective-user permissions are asserted/);
 assert.doesNotMatch(auth,/Last synced 12m ago|218 members|12 groups|Rotate token|Sync now/);
 for(const fake of ["platform-admins","all-employees","sre-oncall","legal-readers"])
   assert.ok(!auth.includes(fake),"Unbacked IdP group "+fake);
 assert.match(v2,/External SCIM identity synchronization, group mappings and effective-user checks are not verified/);
});
test("PER-1606: release-time MFA claims are no longer unconditional dummy state",()=>{
 const auth=between("function AuthSection(", "function AIProvidersSection(");
 assert.match(auth,/Effective step-up policy requires separate server-side verification/);
 assert.match(auth,/Not verified in this view/);
 assert.doesNotMatch(auth,/Force step-up auth when promoting|<Toggle on=\{true\}/);
 assert.match(auth,/Auth0 web application/);
});
test("PER-1606: existing authenticated providers and managed AI routing are retained",()=>{
 assert.match(classic,/createAIConnection/);
 assert.match(classic,/rotateAIConnection/);
 assert.match(classic,/canViewerManageAIConnections/);
 assert.match(classic,/function ClassicSettingsScreen/);
 assert.match(classic,/export function SettingsScreen/);
});
