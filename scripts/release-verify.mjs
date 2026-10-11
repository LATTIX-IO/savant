import {appendFileSync,writeFileSync} from "node:fs";
import {validateReleaseTrigger,getRootPackageVersion} from "./release-guard.mjs";
const version=validateReleaseTrigger({
 eventName:process.env.GITHUB_EVENT_NAME,
 ref:process.env.GITHUB_REF,
 inputVersion:process.env.SAVANT_RELEASE_VERSION,
 packageVersion:getRootPackageVersion(),
 defaultBranch:process.env.SAVANT_DEFAULT_BRANCH||"main"
});
if(!/^[0-9a-f]{40}$/.test(process.env.GITHUB_SHA||""))throw Error("invalid_release_commit");
const data={version,commit:process.env.GITHUB_SHA,package:"savant",kind:"source-verification",published:false};
writeFileSync("release-provenance.json",JSON.stringify(data,null,2)+"\n",{flag:"wx"});
if(process.env.GITHUB_OUTPUT)appendFileSync(process.env.GITHUB_OUTPUT,`verified_version=${version}\n`);
console.log(JSON.stringify({event:"savant_release_preflight",version,sourceCommit:process.env.GITHUB_SHA,published:false}));
