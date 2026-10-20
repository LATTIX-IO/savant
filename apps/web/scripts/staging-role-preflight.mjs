/** Read-only, pre-DDL check for receipt-authorized remote staging migrations.
 * This cannot independently prove full database ACL isolation or KMS custody.
 */
export const STAGING_ROLE_QUERY = [
  "select current_user::text as role_name,",
  "       current_database()::text as database_name,",
  "       r.rolsuper as is_superuser,",
  "       r.rolcreatedb as can_create_database,",
  "       r.rolcreaterole as can_create_role,",
  "       r.rolreplication as can_replicate,",
  "       r.rolbypassrls as can_bypass_rls,",
  "       pg_has_role(current_user, 'pg_read_all_data', 'MEMBER') as can_read_all_data,",
  "       pg_has_role(current_user, 'pg_write_all_data', 'MEMBER') as can_write_all_data,",
  "       pg_has_role(current_user, 'pg_read_server_files', 'MEMBER') as can_read_server_files,",
  "       pg_has_role(current_user, 'pg_write_server_files', 'MEMBER') as can_write_server_files,",
  "       pg_has_role(current_user, 'pg_execute_server_program', 'MEMBER') as can_execute_server_program",
  "from pg_roles r where r.rolname = current_user"
].join("\n");

export const FORBIDDEN_STAGING_ROLE_CAPABILITIES = Object.freeze([
  "is_superuser",
  "can_create_database",
  "can_create_role",
  "can_replicate",
  "can_bypass_rls",
  "can_read_all_data",
  "can_write_all_data",
  "can_read_server_files",
  "can_write_server_files",
  "can_execute_server_program",
]);

export class StagingRolePreflightError extends Error {
  constructor(code) {
    super(code);
    this.name = "StagingRolePreflightError";
    this.code = code;
  }
}

/** Receives exactly one PostgreSQL row. Missing/nonboolean privileges deny. */
export function assertStagingRoleReadiness(rows, {expectedRole, expectedDatabase} = {}) {
  if (!Array.isArray(rows) || rows.length !== 1 || !rows[0] ||
      typeof rows[0] !== "object" || Array.isArray(rows[0])) {
    throw new StagingRolePreflightError("staging_role_evidence_unavailable");
  }
  const row = rows[0];
  if (typeof expectedRole !== "string" || !expectedRole ||
      typeof expectedDatabase !== "string" || !expectedDatabase ||
      row.role_name !== expectedRole || row.database_name !== expectedDatabase) {
    throw new StagingRolePreflightError("staging_role_identity_mismatch");
  }
  if (FORBIDDEN_STAGING_ROLE_CAPABILITIES.some(field => row[field] !== false)) {
    throw new StagingRolePreflightError("staging_role_privileges_excessive");
  }
  return Object.freeze({verified: true});
}
