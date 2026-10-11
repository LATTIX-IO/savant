import { parseRequestEnv, verifyGitTag } from "./release-publication.mjs";
const request = parseRequestEnv();
verifyGitTag(request);
console.log(JSON.stringify({event:"source_release_preflight",version:request.version,commit:request.commit,published:false}));
