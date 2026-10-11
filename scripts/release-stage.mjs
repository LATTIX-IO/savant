import { parseRequestEnv, stageBundle } from "./release-publication.mjs";
const request = parseRequestEnv();
const staged = stageBundle(request);
console.log(JSON.stringify({ event: "source_release_staged", version: staged.tag, commit: staged.commit, sha256: staged.sha256, published: false }));
