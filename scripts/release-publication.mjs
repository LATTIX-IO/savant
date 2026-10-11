import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, readdirSync, lstatSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { gzipSync } from "node:zlib";
import { validateReleaseVersion } from "./release-guard.mjs";

const SHA = /^[0-9a-f]{40}$/;
const REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const DIGEST = /^[0-9a-f]{64}$/;
const MAX_ARCHIVE = 150 * 1024 * 1024;
export const archiveName = (version) => "savant-" + version + ".tar.gz";
export const digestOf = (bytes) => createHash("sha256").update(bytes).digest("hex");

export function validatePublishRequest({ version, commit, confirmation, enabled, ref, repository, runId, mainCommit }) {
  if (typeof version !== "string" || /[\r\n\t]/.test(version)) throw Error("invalid_version");
  validateReleaseVersion(version, version.slice(1));
  if (!SHA.test(commit ?? "")) throw Error("invalid_commit");
  if (!SHA.test(mainCommit ?? "") || mainCommit !== commit) throw Error("requested_commit_not_workflow_head");
  if (ref !== "refs/heads/main") throw Error("publish_requires_main");
  if (enabled !== "true") throw Error("publication_disabled");
  if (confirmation !== "PUBLISH " + version) throw Error("explicit_confirmation_required");
  if (!REPO.test(repository ?? "") || repository.split("/").some(segment => segment === "." || segment === "..")) throw Error("invalid_repository");
  if (!/^[1-9][0-9]{0,19}$/.test(String(runId ?? ""))) throw Error("invalid_run_id");
  return { version, commit, repository, runId: String(runId) };
}
export function assertTaggedSource({ expectedCommit, taggedCommit, packageVersion, version, isMainAncestor }) {
  validateReleaseVersion(version, packageVersion);
  if (!SHA.test(expectedCommit) || !SHA.test(taggedCommit)) throw Error("invalid_commit");
  if (expectedCommit !== taggedCommit) throw Error("tag_commit_mismatch");
  if (!isMainAncestor) throw Error("tag_not_on_main");
  return true;
}
export function run(command, args, options = {}) {
  const r = spawnSync(command, args, { encoding: "buffer", maxBuffer: MAX_ARCHIVE * 2, ...options });
  if (r.error || r.status !== 0 || r.signal) throw Error(command + "_command_failed");
  return r.stdout;
}
export function verifyGitTag(request, executor = run) {
  const { version, commit } = request;
  const tagCommit = executor("git", ["rev-parse", "--verify", "refs/tags/" + version + "^{commit}"]).toString("utf8").trim();
  const rawPackage = executor("git", ["show", commit + ":package.json"]).toString("utf8");
  let parsed;
  try { parsed = JSON.parse(rawPackage); } catch { throw Error("invalid_tagged_package"); }
  if (parsed?.name !== "savant" || parsed?.private !== true) throw Error("invalid_tagged_package");
  let mainAncestor = false;
  try {
    executor("git", ["merge-base", "--is-ancestor", commit, "refs/remotes/origin/main"]);
    mainAncestor = true;
  } catch { /* fail closed */ }
  assertTaggedSource({ expectedCommit: commit, taggedCommit: tagCommit, packageVersion: parsed.version, version, isMainAncestor: mainAncestor });
}
export function makeProvenance(request, archiveBytes) {
  const digest = digestOf(archiveBytes);
  if (archiveBytes.length < 1 || archiveBytes.length > MAX_ARCHIVE) throw Error("invalid_archive_size");
  return {
    schema: "savant.source-release.v1", repository: request.repository,
    tag: request.version, commit: request.commit,
    archive: archiveName(request.version), sha256: digest, bytes: archiveBytes.length,
    runId: request.runId, published: false
  };
}
export function validateBundle(dir, request) {
  const base = archiveName(request.version);
  const expectedFiles = [base, "SHA256SUMS", "release-provenance.json"].sort();
  if (JSON.stringify(readdirSync(dir).sort()) !== JSON.stringify(expectedFiles)) throw Error("unexpected_bundle_contents");
  // Artifacts cross a workflow/job boundary: never dereference symlinks or
  // unexpected filesystem entries, and enforce bounds before reading into memory.
  if (!lstatSync(dir).isDirectory() || lstatSync(dir).isSymbolicLink())
    throw Error("unsafe_bundle_entry");
  for (const name of expectedFiles) {
    const stat = lstatSync(path.join(dir,name));
    const limit = name === base ? MAX_ARCHIVE : 1024 * 1024;
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 1 ||
        stat.size > limit || stat.nlink !== 1) throw Error("unsafe_bundle_entry");
  }
  const bytes = readFileSync(path.join(dir, base));
  const provenance = JSON.parse(readFileSync(path.join(dir, "release-provenance.json"), "utf8"));
  const checksumBytes = readFileSync(path.join(dir, "SHA256SUMS"));
  const checksum = checksumBytes.toString("utf8");
  const manifestBytes = readFileSync(path.join(dir, "release-provenance.json"));
  if (provenance.schema !== "savant.source-release.v1" ||
      provenance.repository !== request.repository || provenance.tag !== request.version ||
      provenance.commit !== request.commit || provenance.archive !== base ||
      !DIGEST.test(provenance.sha256 ?? "") || provenance.bytes !== bytes.length ||
      String(provenance.runId) !== request.runId ||
      provenance.published !== false || !/^[1-9][0-9]{0,19}$/.test(String(provenance.runId ?? "")) ||
      provenance.sha256 !== digestOf(bytes) ||
      checksum !== provenance.sha256 + "  " + base + "\n") throw Error("release_bundle_integrity_failed");
  const files = Object.fromEntries([
    [base, bytes], ["SHA256SUMS", checksumBytes], ["release-provenance.json", manifestBytes]
  ].map(([name, content]) => [name, { sha256: digestOf(content), bytes: content.length }]));
  return { base, digest: provenance.sha256, provenance, files };
}
export function stageBundle(request, { executor = run, output = "dist/source-release" } = {}) {
  verifyGitTag(request, executor);
  const tar = executor("git", ["archive", "--format=tar", "--prefix=savant-" + request.version.slice(1) + "/", request.commit]);
  const bytes = gzipSync(tar, { level: 9, mtime: 0 });
  const provenance = makeProvenance(request, bytes);
  mkdirSync(output, { recursive: true });
  writeFileSync(path.join(output, archiveName(request.version)), bytes, { flag: "wx", mode: 0o600 });
  writeFileSync(path.join(output, "SHA256SUMS"), provenance.sha256 + "  " + provenance.archive + "\n", { flag: "wx", mode: 0o600 });
  writeFileSync(path.join(output, "release-provenance.json"), JSON.stringify(provenance, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  const inspected = validateBundle(output, request);
  return { ...provenance, files: inspected.files };
}
export function classifyExistingRelease(existing, request, manifest) {
  if (existing == null) return "create";
  if (existing.tagName !== request.version || existing.isDraft || existing.isPrerelease !== request.version.includes("-")) throw Error("existing_release_conflict");
  const names = [archiveName(request.version), "SHA256SUMS", "release-provenance.json"].sort();
  if (!Array.isArray(existing.assets) || JSON.stringify(existing.assets.map(a => a.name).sort()) !== JSON.stringify(names)) throw Error("existing_release_conflict");
  if (!manifest?.files || Object.keys(manifest.files).sort().join("|") !== names.join("|")) throw Error("existing_release_conflict");
  for (const name of names) {
    const expectation = manifest.files[name];
    const asset = existing.assets.find(a => a.name === name);
    if (!expectation || !DIGEST.test(expectation.sha256) || !Number.isSafeInteger(expectation.bytes) ||
        asset?.digest !== "sha256:" + expectation.sha256 || asset.size !== expectation.bytes) throw Error("existing_release_conflict");
  }
  return "unchanged";
}
export function parseRequestEnv(env = process.env) {
  return validatePublishRequest({
    version: env.SAVANT_PUBLISH_VERSION, commit: env.SAVANT_PUBLISH_COMMIT,
    confirmation: env.SAVANT_PUBLISH_CONFIRMATION, enabled: env.SAVANT_RELEASE_PUBLISH_ENABLED,
    ref: env.GITHUB_REF, repository: env.GITHUB_REPOSITORY, runId: env.GITHUB_RUN_ID,
    mainCommit: env.GITHUB_SHA
  });
}
