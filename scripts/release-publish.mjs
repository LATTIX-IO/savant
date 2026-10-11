import { parseRequestEnv, validateBundle, verifyGitTag, run, archiveName } from "./release-publication.mjs";
const TIMEOUT_MS = 15000;
export async function inspectExistingRelease(request, token, fetcher = fetch) {
  if (!token) throw Error("missing_github_token");
  const url = "https://api.github.com/repos/" + request.repository + "/releases/tags/" + encodeURIComponent(request.version);
  const response = await fetcher(url, { headers: {
    Authorization: "Bearer " + token, Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28"
  }, signal: AbortSignal.timeout(TIMEOUT_MS), redirect: "error" });
  if (response.status === 404) return null;
  if (response.status !== 200) throw Error("github_release_lookup_failed");
  let data;
  try { data = await response.json(); } catch { throw Error("github_release_response_invalid"); }
  if (!data || typeof data !== "object" || !Array.isArray(data.assets)) throw Error("github_release_response_invalid");
  return { tagName: data.tag_name, isDraft: data.draft, isPrerelease: data.prerelease, assets: data.assets.map(a => ({ name: a.name, size: a.size, digest: a.digest })) };
}
export async function publishSourceRelease(request, options = {}) {
  const bundle = validateBundle(options.dir || "dist/source-release", request);
  verifyGitTag(request, options.git || run);
  const token = options.token ?? process.env.GH_TOKEN;
  const fetcher = options.fetcher || fetch;
  const existing = await inspectExistingRelease(request, token, fetcher);
  const { classifyExistingRelease } = await import("./release-publication.mjs");
  const decision = classifyExistingRelease(existing, request, bundle);
  if (decision === "unchanged") return { state: "existing_verified", sha256: bundle.digest };
  const cwd = options.dir || "dist/source-release";
  const paths = [archiveName(request.version), "SHA256SUMS", "release-provenance.json"].map(n => cwd + "/" + n);
  const args = ["release","create",request.version,...paths,"--repo",request.repository,
    "--verify-tag","--target",request.commit,"--title","Savant "+request.version,
    "--notes","Verified source archive. SHA-256 and provenance attached. See GitHub attestation for signed build provenance."];
  if (request.version.includes("-")) args.push("--prerelease");
  try { (options.runGh || run)("gh",args); }
  catch (error) {
    // A competing publisher may win. We accept ONLY identical published assets.
    const raced = await inspectExistingRelease(request, token, fetcher);
    if (raced && classifyExistingRelease(raced, request, bundle) === "unchanged")
      return { state: "existing_verified", sha256: bundle.digest };
    throw error;
  }
  // Read back and compare server asset digests before reporting a successful release.
  const published = await inspectExistingRelease(request, token, fetcher);
  if (classifyExistingRelease(published, request, bundle) !== "unchanged") throw Error("published_release_integrity_failed");
  return { state: "published_verified", sha256: bundle.digest };
}
if (process.argv[1]?.endsWith("/release-publish.mjs")) {
  const request = parseRequestEnv();
  const result = await publishSourceRelease(request);
  console.log(JSON.stringify({ event: "source_release_publication", version: request.version, ...result }));
}
