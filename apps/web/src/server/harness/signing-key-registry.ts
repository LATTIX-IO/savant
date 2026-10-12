/**
 * Internal harness signing credential lifecycle. No HTTP handler is exported.
 * Authentication, admin authorization and vaulted key storage are injected.
 * Secret material is never persisted or returned by mutation methods.
 */
import type { Sql } from "postgres";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const MAX_LIFETIME_MS = 180 * 86400000;
const MAX_GRACE_MS = 86400000;
type KeyStatus = "active" | "retiring" | "revoked";
type Row = {
  id: string;
  organization_id: string;
  adapter_id: string;
  key_version: number;
  secret_ref: string;
  status: KeyStatus;
  not_before: Date;
  expires_at: Date;
};
export class HarnessSigningKeyError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(code);
    this.name = "HarnessSigningKeyError";
    this.code = code;
  }
}
function fail(code: string): never { throw new HarnessSigningKeyError(code); }
function validateScope(tenantId: string, adapterId: string): void {
  if (typeof tenantId !== "string" || !UUID.test(tenantId) ||
      typeof adapterId !== "string" || !ID.test(adapterId)) fail("invalid_scope");
}
function validateRef(tenantId: string, adapterId: string, ref: string): void {
  // Require an explicit tenant+adapter namespace, not a caller-supplied URL.
  const prefix = `vault:${tenantId}:${adapterId}:`;
  if (typeof ref !== "string" || !ref.startsWith(prefix) ||
      ref.length > 256 || !ID.test(ref.slice(prefix.length))) fail("invalid_ref");
}
function validDate(value: Date): boolean {
  return value instanceof Date && Number.isFinite(value.getTime());
}
function publicKey(row: Row) {
  return {
    tenantId: row.organization_id, adapterId: row.adapter_id,
    version: row.key_version, status: row.status,
    notBefore: new Date(row.not_before).toISOString(),
    expiresAt: new Date(row.expires_at).toISOString(),
  };
}
export function createHarnessSigningKeyRegistry(deps: {
  sql: Sql;
  now: () => Date;
  /** Must cryptographically authorize active tenant administrator, not trust actor text. */
  authorizeAdmin: (tenantId: string, actor: string) => Promise<boolean>;
  /** Scoped vault adapter must enforce tenant/adapter/reference binding. */
  readSecret: (tenantId: string, adapterId: string, ref: string) => Promise<Uint8Array | null>;
}) {
  const { sql } = deps;
  function clock(): Date {
    const now = deps.now();
    if (!validDate(now)) fail("invalid_configuration");
    return now;
  }
  async function requireAdmin(tenantId: string, adapterId: string, actor: string) {
    validateScope(tenantId, adapterId);
    if (typeof actor !== "string" || !ID.test(actor)) fail("unauthorized");
    let authorized = false;
    try { authorized = await deps.authorizeAdmin(tenantId, actor); } catch { /* fail closed */ }
    if (!authorized) fail("unauthorized");
  }
  async function getVaultKey(tenantId: string, adapterId: string, ref: string): Promise<Uint8Array> {
    validateRef(tenantId, adapterId, ref);
    let raw: Uint8Array | null;
    try { raw = await deps.readSecret(tenantId, adapterId, ref); }
    catch { return fail("vault_unavailable"); }
    if (!(raw instanceof Uint8Array) || raw.byteLength < 32 || raw.byteLength > 128)
      fail("vault_unavailable");
    return Buffer.from(raw);
  }
  return {
    /** Initial activation or rotation, with <=24h previous-key overlap. */
    async activate(input: {
      tenantId: string; adapterId: string; actor: string; secretRef: string;
      version: number; notBefore: Date; expiresAt: Date; graceMs?: number;
    }) {
      await requireAdmin(input.tenantId, input.adapterId, input.actor);
      validateRef(input.tenantId, input.adapterId, input.secretRef);
      const at = clock(), grace = input.graceMs ?? 3600000;
      if (!Number.isSafeInteger(input.version) || input.version < 1 ||
          !Number.isSafeInteger(grace) || grace < 0 || grace > MAX_GRACE_MS ||
          !validDate(input.notBefore) || !validDate(input.expiresAt) ||
          input.notBefore.getTime() > at.getTime() ||
          input.expiresAt.getTime() <= at.getTime() ||
          input.expiresAt.getTime() - at.getTime() > MAX_LIFETIME_MS)
        fail("invalid_key_policy");
      // Fail before writing anything if the secret is missing in the scoped vault.
      await getVaultKey(input.tenantId, input.adapterId, input.secretRef);
      return sql.begin(async tx => {
        const org = await tx<{id:string}[]>`
          select id from organizations where id=${input.tenantId} for update
        `;
        if (!org.length) fail("not_found");
        const current = await tx<Row[]>`
          select * from harness_adapter_signing_keys
          where organization_id=${input.tenantId} and adapter_id=${input.adapterId}
          order by key_version desc for update
        `;
        const maxVersion = current[0]?.key_version ?? 0;
        if (input.version <= maxVersion) fail("version_conflict");
        // Fully revoke old retiring keys before creating a fresh retire overlap.
        await tx`
          update harness_adapter_signing_keys
          set status='revoked',updated_at=${at}
          where organization_id=${input.tenantId} and adapter_id=${input.adapterId}
            and status='retiring'
        `;
        await tx`
          update harness_adapter_signing_keys
          set status=case when ${grace}>0 and expires_at>${at} then 'retiring'
            else 'revoked' end,
            expires_at=case when ${grace}>0
              then least(expires_at,${new Date(at.getTime()+grace)}) else expires_at end,
            updated_at=${at}
          where organization_id=${input.tenantId} and adapter_id=${input.adapterId}
            and status='active'
        `;
        const rows = await tx<Row[]>`
          insert into harness_adapter_signing_keys
            (organization_id,adapter_id,key_version,secret_ref,status,not_before,expires_at)
          values (${input.tenantId},${input.adapterId},${input.version},
            ${input.secretRef},'active',${input.notBefore},${input.expiresAt})
          returning *
        `;
        return publicKey(rows[0]!);
      });
    },
    /** Revocation is irreversible; new keys require a greater key_version. */
    async revoke(input:{tenantId:string;adapterId:string;actor:string;version:number}) {
      await requireAdmin(input.tenantId, input.adapterId, input.actor);
      if (!Number.isSafeInteger(input.version) || input.version < 1) fail("invalid_key_policy");
      const at = clock();
      return sql.begin(async tx => {
        const org = await tx<{id:string}[]>`
          select id from organizations where id=${input.tenantId} for update
        `;
        if (!org.length) fail("not_found");
        const rows = await tx<Row[]>`
          update harness_adapter_signing_keys
          set status='revoked',updated_at=${at}
          where organization_id=${input.tenantId} and adapter_id=${input.adapterId}
            and key_version=${input.version} returning *
        `;
        if (!rows.length) fail("not_found");
        return publicKey(rows[0]!);
      });
    },
    /** For injection into createSignedHarnessEventAdmission.resolveSecrets. */
    async resolveSecrets(tenantId:string,adapterId:string):Promise<readonly Uint8Array[]> {
      validateScope(tenantId,adapterId);
      const at=clock();
      const rows=await sql<Row[]>`
        select * from harness_adapter_signing_keys
        where organization_id=${tenantId} and adapter_id=${adapterId}
          and status in ('active','retiring') and not_before<=${at} and expires_at>${at}
        order by case when status='active' then 0 else 1 end,key_version desc
        limit 2
      `;
      // Never fall back to a retired key alone if the active key expired/revoked.
      if (rows.length===0 || rows[0]!.status!=="active") fail("no_active_key");
      const secrets:Uint8Array[]=[];
      for(const row of rows) secrets.push(await getVaultKey(tenantId,adapterId,row.secret_ref));
      if (secrets.length===2 && Buffer.from(secrets[0]!).equals(Buffer.from(secrets[1]!)))
        fail("duplicate_secret");
      return secrets;
    },
  };
}
