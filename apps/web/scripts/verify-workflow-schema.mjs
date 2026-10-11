import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import postgres from "postgres";

/** Run only against CI/local PostgreSQL. Never run on a tenant's production DB. */
const target = process.env.DATABASE_URL;
if (!target || process.env.SAVANT_WORKFLOW_SCHEMA_TEST !== "1" || !["localhost", "127.0.0.1", "::1"].includes(new URL(target).hostname)) {
  throw new Error("Workflow schema integration tests require explicit local PostgreSQL opt-in.");
}
const sql = postgres(target, { max: 1, prepare: false });
const stamp = randomUUID().slice(0, 8);
let orgA;
let orgB;
try {
  const [a] = await sql`insert into organizations (slug, display_name) values (${"workflow-it-a-"+stamp},'Workflow Test A') returning id`;
  const [b] = await sql`insert into organizations (slug, display_name) values (${"workflow-it-b-"+stamp},'Workflow Test B') returning id`;
  orgA = a.id; orgB = b.id;
  const [repo] = await sql`
    insert into repositories (organization_id,provider_type,owner_name,repo_name,default_branch)
    values (${orgA},'github','workflow-test',${"repo-"+stamp},'main') returning id
  `;
  const commit = "a".repeat(40);
  const digest = "b".repeat(64);
  const insert = () => sql`
    insert into workflow_artifact_versions (organization_id,repository_id,workflow_id,specification_version,
      source_commit_sha,content_blob_sha,canonical_digest,actor_subject)
    values (${orgA},${repo.id},'triage','1.0.0',${commit},${"c".repeat(40)},${digest},'test-owner')
    on conflict (organization_id,repository_id,workflow_id,source_commit_sha) do nothing
  `;
  await insert();
  await insert();
  let rows = await sql`select source_commit_sha, canonical_digest from workflow_artifact_versions
    where organization_id=${orgA} and repository_id=${repo.id}`;
  assert.equal(rows.length, 1, "idempotent version inserts must be unique");
  assert.equal(rows[0].canonical_digest, digest);

  let foreignDenied = false;
  try {
    await sql`
      insert into workflow_artifact_versions (organization_id,repository_id,workflow_id,specification_version,
        source_commit_sha,content_blob_sha,canonical_digest,actor_subject)
      values (${orgB},${repo.id},'foreign','1.0.0',${commit},${"c".repeat(40)},${digest},'foreign-actor')
    `;
  } catch (error) {
    foreignDenied = error?.code === "23503";
    if (!foreignDenied) throw error;
  }
  assert.equal(foreignDenied, true, "foreign-tenant repo must fail at the composite database FK");

  const newVersion = "d".repeat(40);
  try {
    await sql.begin(async tx => {
      await tx`insert into workflow_artifact_versions (organization_id,repository_id,workflow_id,specification_version,
        source_commit_sha,content_blob_sha,canonical_digest,actor_subject)
        values (${orgA},${repo.id},'triage','2.0.0',${newVersion},${"e".repeat(40)},${digest},'test-owner')`;
      throw new Error("EXPECTED_ROLLBACK");
    });
  } catch (error) {
    if (error?.message !== "EXPECTED_ROLLBACK") throw error;
  }
  rows = await sql`select id from workflow_artifact_versions
    where organization_id=${orgA} and source_commit_sha=${newVersion}`;
  assert.equal(rows.length, 0, "rolled-back version must not persist");

  await sql`delete from repositories where id=${repo.id} and organization_id=${orgA}`;
  rows = await sql`select id from workflow_artifact_versions where repository_id=${repo.id}`;
  assert.equal(rows.length, 0, "repository deletion must cascade to metadata index");

  console.log(JSON.stringify({
    workflowSchema: "passed",
    assertions: ["idempotency","org-repo isolation","transaction rollback","cascade"],
    migratedVersion: "0012",
  }));
} finally {
  if (orgA) await sql`delete from organizations where id=${orgA}`;
  if (orgB) await sql`delete from organizations where id=${orgB}`;
  await sql.end({ timeout: 5 });
}
