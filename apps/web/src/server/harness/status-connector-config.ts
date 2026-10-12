/**
 * Private administrative configuration for signed customer-harness status.
 * No public route and NO secret values in PostgreSQL.
 * All authorization, vault attestation and egress policy are injected.
 */
import type {Sql} from "postgres";
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ID=/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
type Row={organization_id:string;adapter_id:string;endpoint:string;secret_ref:string;
  status:"active"|"disabled";revision:number;updated_by:string};
export class HarnessConnectorConfigError extends Error {
  readonly code:string;
  constructor(code:string){super(code);this.name="HarnessConnectorConfigError";this.code=code;}
}
function fail(code:string):never{throw new HarnessConnectorConfigError(code);}
function validate(tenantId:string,adapterId:string){
  if(typeof tenantId!=="string"||!UUID.test(tenantId)||
    typeof adapterId!=="string"||!ID.test(adapterId))fail("invalid_scope");
}
function validateActor(actor:string){
  if(typeof actor!=="string"||!ID.test(actor))fail("unauthorized");
}
function validRevision(r:number|null):boolean {
  return r===null||(Number.isSafeInteger(r)&&r>0&&r<2147483647);
}
function validateRef(tenantId:string,adapterId:string,ref:string){
  const prefix=`vault:${tenantId}:${adapterId}:`;
  if(typeof ref!=="string"||!ref.startsWith(prefix)||
    ref.length>256||!ID.test(ref.slice(prefix.length)))fail("invalid_secret_ref");
}
function validateUrl(value:string,allowedOrigins:readonly string[]):string{
  if(typeof value!=="string"||value.length>512||!Array.isArray(allowedOrigins)||
    allowedOrigins.length===0)fail("invalid_endpoint");
  let uri:URL;
  try{uri=new URL(value);}catch{return fail("invalid_endpoint");}
  if(uri.protocol!=="https:"||uri.username||uri.password||uri.port||
    uri.search||uri.hash||uri.pathname!=="/v1/savant/status"||
    !/^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/i.test(uri.hostname)||
    !allowedOrigins.includes(uri.origin))fail("invalid_endpoint");
  return uri.href;
}
function publicMetadata(r:Row){
  return {tenantId:r.organization_id,adapterId:r.adapter_id,
    endpoint:r.endpoint,status:r.status,revision:r.revision};
}
export function createHarnessStatusConnectorConfigStore(deps:{
  sql:Sql; now:()=>Date;
  allowedOrigins:readonly string[];
  /** Actual authenticated organization security administrator. */
  authorizeAdmin:(scope:{tenantId:string;adapterId:string;actor:string})=>Promise<boolean>;
  /** Must attest scoped key exists in tenant vault. Do not return key material. */
  attestSecret:(scope:{tenantId:string;adapterId:string;secretRef:string})=>Promise<boolean>;
  /** Requires gateway DNS/IP deny+TLS pinning enforcement, not only hostname allowlist. */
  verifyEgress:(tenantId:string,endpoint:string)=>Promise<boolean>;
}){
  const {sql}=deps;
  function clock(){
    const at=deps.now();
    if(!(at instanceof Date)||!Number.isFinite(at.getTime()))fail("invalid_configuration");
    return at;
  }
  async function admin(tenantId:string,adapterId:string,actor:string){
    validate(tenantId,adapterId);validateActor(actor);
    let authorized=false;
    try{authorized=await deps.authorizeAdmin({tenantId,adapterId,actor});}catch{/* deny */}
    if(!authorized)fail("unauthorized");
  }
  async function egress(tenantId:string,endpoint:string){
    let ok=false;
    try{ok=await deps.verifyEgress(tenantId,endpoint);}catch{/* deny */}
    if(!ok)fail("egress_unavailable");
  }
  async function attest(tenantId:string,adapterId:string,secretRef:string){
    let exists=false;
    try{exists=await deps.attestSecret({tenantId,adapterId,secretRef});}
    catch{/* deny */}
    if(!exists)fail("credential_unavailable");
  }
  return {
    /** CAS upsert resets status to DISABLED. Version mismatches cannot overwrite. */
    async save(input:{tenantId:string;adapterId:string;actor:string;
      endpoint:string;secretRef:string;expectedRevision:number|null}){
      if(!input||typeof input!=="object")fail("invalid_scope");
      await admin(input.tenantId,input.adapterId,input.actor);
      if(!validRevision(input.expectedRevision))fail("version_conflict");
      const endpoint=validateUrl(input.endpoint,deps.allowedOrigins);
      validateRef(input.tenantId,input.adapterId,input.secretRef);
      await attest(input.tenantId,input.adapterId,input.secretRef);
      const at=clock();
      return sql.begin(async tx=>{
        const org=await tx<{id:string}[]>`
          select id from organizations where id=${input.tenantId} for update
        `;
        if(!org.length)fail("not_found");
        const existing=await tx<Row[]>`
          select * from harness_status_connector_configs
          where organization_id=${input.tenantId} and adapter_id=${input.adapterId}
          for update
        `;
        const previous=existing[0];
        if(!previous&&input.expectedRevision!==null)fail("version_conflict");
        if(previous&&previous.revision!==input.expectedRevision)fail("version_conflict");
        let changed:Row[];
        if(previous){
          changed=await tx<Row[]>`
            update harness_status_connector_configs
              set endpoint=${endpoint},secret_ref=${input.secretRef},
                status='disabled',revision=revision+1,
                updated_by=${input.actor},updated_at=${at}
            where organization_id=${input.tenantId} and adapter_id=${input.adapterId}
            returning *
          `;
        }else{
          changed=await tx<Row[]>`
            insert into harness_status_connector_configs
              (organization_id,adapter_id,endpoint,secret_ref,status,updated_by,created_at,updated_at)
            values (${input.tenantId},${input.adapterId},${endpoint},
              ${input.secretRef},'disabled',${input.actor},${at},${at})
            returning *
          `;
        }
        return publicMetadata(changed[0]!);
      });
    },
    /** Explicit admin enable; never reuse an unchecked/stale vault or gateway. */
    async activate(input:{tenantId:string;adapterId:string;actor:string;expectedRevision:number}){
      if(!input||typeof input!=="object")fail("invalid_scope");
      await admin(input.tenantId,input.adapterId,input.actor);
      if(!validRevision(input.expectedRevision)||input.expectedRevision===null)
        fail("version_conflict");
      const at=clock();
      return sql.begin(async tx=>{
        const org=await tx<{id:string}[]>`
          select id from organizations where id=${input.tenantId} for update
        `;
        if(!org.length)fail("not_found");
        const existing=await tx<Row[]>`
          select * from harness_status_connector_configs
          where organization_id=${input.tenantId} and adapter_id=${input.adapterId}
          for update
        `;
        const current=existing[0];
        if(!current)fail("not_found");
        if(current.revision!==input.expectedRevision)fail("version_conflict");
        if(current.status==="active")fail("already_active");
        validateUrl(current.endpoint,deps.allowedOrigins);
        validateRef(input.tenantId,input.adapterId,current.secret_ref);
        await attest(input.tenantId,input.adapterId,current.secret_ref);
        await egress(input.tenantId,current.endpoint);
        const updated=await tx<Row[]>`
          update harness_status_connector_configs
            set status='active',revision=revision+1,
              updated_by=${input.actor},updated_at=${at}
          where organization_id=${input.tenantId} and adapter_id=${input.adapterId}
          returning *
        `;
        return publicMetadata(updated[0]!);
      });
    },
    async disable(input:{tenantId:string;adapterId:string;actor:string;expectedRevision:number}){
      if(!input||typeof input!=="object")fail("invalid_scope");
      await admin(input.tenantId,input.adapterId,input.actor);
      if(!validRevision(input.expectedRevision)||input.expectedRevision===null)
        fail("version_conflict");
      const at=clock();
      return sql.begin(async tx=>{
        const org=await tx<{id:string}[]>`
          select id from organizations where id=${input.tenantId} for update
        `;
        if(!org.length)fail("not_found");
        const updated=await tx<Row[]>`
          update harness_status_connector_configs
            set status='disabled',revision=revision+1,
              updated_by=${input.actor},updated_at=${at}
          where organization_id=${input.tenantId} and adapter_id=${input.adapterId}
            and revision=${input.expectedRevision}
          returning *
        `;
        if(!updated.length)fail("version_conflict");
        return publicMetadata(updated[0]!);
      });
    },
    /** Internal trusted lookup only. Never expose secret_ref to a browser. */
    async resolveActive(tenantId:string,adapterId:string){
      validate(tenantId,adapterId);
      const rows=await sql<Row[]>`
        select * from harness_status_connector_configs
        where organization_id=${tenantId} and adapter_id=${adapterId} and status='active'
      `;
      const current=rows[0];
      if(!current)return null;
      // Fail closed if deployment policy changed after configuration was enabled.
      const endpoint=validateUrl(current.endpoint,deps.allowedOrigins);
      validateRef(tenantId,adapterId,current.secret_ref);
      await egress(tenantId,endpoint);
      return {endpoint,secretRef:current.secret_ref};
    },
  };
}
