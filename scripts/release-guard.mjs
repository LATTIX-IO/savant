import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const VERSION = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;
export function validateReleaseVersion(input, packageVersion) {
  if(typeof input !== "string" || input.length > 100 || !VERSION.test(input)) throw Error("invalid_release_version");
  if(typeof packageVersion !== "string" || !VERSION.test("v"+packageVersion)) throw Error("invalid_package_version");
  // Prereleases are allowed only when root package declares that exact version.
  if(input !== "v"+packageVersion) throw Error("release_version_mismatch");
  return input;
}
export function validateReleaseTrigger({eventName, ref, inputVersion, packageVersion, defaultBranch = "main"}) {
  if(eventName === "push") {
    if(typeof ref !== "string" || !ref.startsWith("refs/tags/")) throw Error("release_tag_required");
    return validateReleaseVersion(ref.slice("refs/tags/".length),packageVersion);
  }
  if(eventName === "workflow_dispatch") {
    if(ref !== "refs/heads/"+defaultBranch) throw Error("manual_release_requires_default_branch");
    return validateReleaseVersion(inputVersion,packageVersion);
  }
  throw Error("implicit_release_disallowed");
}
export function getRootPackageVersion(directory=process.cwd()) {
  const data=JSON.parse(readFileSync(resolve(directory,"package.json"),"utf8"));
  if(data.name!=="savant" || !data.private || typeof data.version!=="string") throw Error("invalid_release_package");
  return data.version;
}
