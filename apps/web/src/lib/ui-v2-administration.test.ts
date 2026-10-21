import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
test("UX-06 uses scoped provider metadata, avoids credential exposure and retains server-owned mutations",()=>{
 const integrations=readFileSync(fileURLToPath(new URL("../components/savant/screens/integrations-v2.tsx",import.meta.url)),"utf8");
 const settings=readFileSync(fileURLToPath(new URL("../components/savant/screens/settings-v2.tsx",import.meta.url)),"utf8");
 const classic=readFileSync(fileURLToPath(new URL("../components/savant/screens/settings.tsx",import.meta.url)),"utf8");
 const router=readFileSync(fileURLToPath(new URL("../components/savant/screens/skill-router.tsx",import.meta.url)),"utf8");
 for(const field of ["fetchRepositoryList","fetchAIConnections","fetchConnectorDashboard",
   "inspectUiV2ProviderLanes","workspaceSlug:slug,signal:controller.signal"])assert.ok(integrations.includes(field));
 assert.match(integrations,/API credentials are never returned/);
 assert.match(integrations,/tenant-scoped agent-client inventory API is not available/);
 assert.match(integrations,/No step uses browser-local simulated state/);
 assert.match(settings,/External SCIM identity synchronization/);
 assert.match(settings,/existing owner entitlements/);
 assert.match(classic,/ClassicSettingsScreen/);
 assert.match(router,/ClassicSkillRouterScreen/);
 for(const screen of [integrations,settings]){
   assert.doesNotMatch(screen,/localStorage|sessionStorage|dangerouslySetInnerHTML|\.innerHTML\s*=|Math\.random|createAIConnection\(|rotateAIConnection\(/);
 }
});
