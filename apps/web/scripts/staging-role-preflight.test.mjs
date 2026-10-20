import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";
import {
  assertStagingRoleReadiness,
  FORBIDDEN_STAGING_ROLE_CAPABILITIES,
  STAGING_ROLE_QUERY,
  StagingRolePreflightError,
} from "./staging-role-preflight.mjs";

const row = () => ({role_name: "stage_operator", database_name: "savant_stage",
  ...Object.fromEntries(FORBIDDEN_STAGING_ROLE_CAPABILITIES.map(field => [field, false]))});
const opts = {expectedRole: "stage_operator", expectedDatabase: "savant_stage"};
const rejected = code => error => error instanceof StagingRolePreflightError && error.code === code;

test("PER-1591: exact authenticated staging role without elevated capabilities passes", () => {
  assert.deepEqual(assertStagingRoleReadiness([row()], opts), {verified: true});
  assert.match(STAGING_ROLE_QUERY, /current_user/);
  assert.match(STAGING_ROLE_QUERY, /current_database\(\)/);
  assert.match(STAGING_ROLE_QUERY, /pg_roles/);
  assert.doesNotMatch(STAGING_ROLE_QUERY, /\b(insert|update|delete|alter|create|drop|grant|revoke)\s/);
});

test("PER-1591: impersonated role and wrong database always fail closed", () => {
  for (const altered of [
    {...row(), role_name: "postgres"},
    {...row(), database_name: "production"},
    {...row(), role_name: null},
    {...row(), database_name: null},
  ]) assert.throws(() => assertStagingRoleReadiness([altered], opts),
    rejected("staging_role_identity_mismatch"));
  for (const expected of [{}, {expectedRole: "", expectedDatabase: "savant_stage"},
    {expectedRole: "stage_operator", expectedDatabase: null}]) {
    assert.throws(() => assertStagingRoleReadiness([row()], expected),
      rejected("staging_role_identity_mismatch"));
  }
});

test("PER-1591: superuser, object-admin, RLS bypass and broad server roles denied", () => {
  for (const capability of FORBIDDEN_STAGING_ROLE_CAPABILITIES) {
    for (const value of [true, null, undefined, "false", 0]) {
      const elevated = row(); elevated[capability] = value;
      assert.throws(() => assertStagingRoleReadiness([elevated], opts),
        rejected("staging_role_privileges_excessive"), capability + "=" + String(value));
    }
  }
});

test("PER-1591: empty, multiple or malformed database role rows fail closed", () => {
  for (const rows of [undefined, null, {}, [], [null], [true], ["admin"], [row(),row()]]) {
    assert.throws(() => assertStagingRoleReadiness(rows, opts),
      rejected("staging_role_evidence_unavailable"));
  }
});

test("PER-1591: remote-only role preflight before schema DDL; never print SQL or credentials", () => {
  const source = readFileSync(new URL("./apply-db-schema.mjs", import.meta.url), "utf8");
  const guard = source.indexOf('grant.scope === "signed-staging-only"');
  const inspect = source.indexOf("assertStagingRoleReadiness(", guard);
  const migrate = source.indexOf("for (const schemaFile of schemaFiles)", guard);
  assert.ok(guard > 0 && inspect > guard && migrate > inspect);
  const segment = source.slice(guard, migrate);
  assert.match(segment, /staging_role_preflight_unavailable/);
  assert.doesNotMatch(segment, /console\.error\([^\n]*error\.message|console\.error\([^\n]*databaseUrl/);
  assert.match(source.slice(0,guard), /authorizeSchemaApply\(/);
});
