import {
  createCipheriv,createDecipheriv,randomBytes,createHash
} from "node:crypto";
import {execFileSync,spawnSync} from "node:child_process";
import {readFile,writeFile,chmod,mkdtemp,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";

const MAGIC=Buffer.from("SAVANT-CI-BACKUP-V1","ascii");
const MAX_BACKUP_BYTES=20*1024*1024; // isolated synthetic fixtures only
const BACKUP_TIMEOUT=60000;
const URI_HOSTS=new Set(["localhost","127.0.0.1"]);
const NAME=/^savant_restore_[a-f0-9]{8}_(?:pre|post)$/;
export class EphemeralRestoreError extends Error{
  constructor(code){super(code);this.name="EphemeralRestoreError";this.code=code;}
}
const fail=code=>{throw new EphemeralRestoreError(code);};
const hash=v=>createHash("sha256").update(v).digest("hex");
const requireKey=key=>{
  if(!Buffer.isBuffer(key)||key.length!==32)fail("synthetic_backup_key_invalid");
};
export function encryptFixtureBackup(raw,key){
  requireKey(key);
  if(!Buffer.isBuffer(raw)||!raw.length||raw.length>MAX_BACKUP_BYTES)
    fail("synthetic_backup_size_invalid");
  const iv=randomBytes(12),cipher=createCipheriv("aes-256-gcm",key,iv);
  cipher.setAAD(MAGIC);
  const encrypted=Buffer.concat([cipher.update(raw),cipher.final()]);
  return Buffer.concat([MAGIC,iv,cipher.getAuthTag(),encrypted]);
}
export function decryptFixtureBackup(blob,key){
  requireKey(key);
  try{
    if(!Buffer.isBuffer(blob)||blob.length<MAGIC.length+12+16+1||
      blob.length>MAX_BACKUP_BYTES+MAGIC.length+28||
      !blob.subarray(0,MAGIC.length).equals(MAGIC))
      fail("synthetic_backup_envelope_invalid");
    const iv=blob.subarray(MAGIC.length,MAGIC.length+12);
    const tag=blob.subarray(MAGIC.length+12,MAGIC.length+28);
    const body=blob.subarray(MAGIC.length+28);
    const dec=createDecipheriv("aes-256-gcm",key,iv);
    dec.setAAD(MAGIC);dec.setAuthTag(tag);
    return Buffer.concat([dec.update(body),dec.final()]);
  }catch{
    // No raw OpenSSL, PG or backup content may leak.
    fail("synthetic_backup_integrity_failure");
  }
}
export function assertEphemeralRestoreContext(env=process.env){
  if(env.CI!=="true"||env.SAVANT_EPHEMERAL_RESTORE_TEST!=="1"||
    env.SAVANT_WORKFLOW_SCHEMA_TEST!=="1"||
    env.PGPASSWORD!=="integration_only")
    fail("ephemeral_restore_environment_denied");
  let url;
  try{url=new URL(env.DATABASE_URL);}
  catch{fail("ephemeral_restore_database_denied");}
  if(url.protocol!=="postgresql:"||!URI_HOSTS.has(url.hostname)||
    (url.port&&url.port!=="5432")||url.username!=="savant"||
    url.pathname!=="/savant"||url.password||url.search||url.hash)
    fail("ephemeral_restore_database_denied");
  return Object.freeze({host:"127.0.0.1",port:"5432",user:"savant",database:"savant"});
}
function requireName(name){
  if(typeof name!=="string"||!NAME.test(name))
    fail("ephemeral_restore_database_name_invalid");
  return name;
}
function pgCommand(executable,args,{env=process.env,input=null,output=false}={}){
  let result;
  try{
    if(input!==null){
      const p=spawnSync(executable,args,{input,timeout:BACKUP_TIMEOUT,
        maxBuffer:1024*1024,env,stdio:["pipe","pipe","pipe"]});
      if(p.error||p.signal||p.status!==0)fail("ephemeral_restore_pg_command_failed");
      result=p.stdout;
    }else{
      result=execFileSync(executable,args,{env,timeout:BACKUP_TIMEOUT,
        maxBuffer:MAX_BACKUP_BYTES,stdio:["ignore","pipe","pipe"]});
    }
  }catch{fail("ephemeral_restore_pg_command_failed");}
  return output?result:undefined;
}
function baseArgs(ctx){return ["-h",ctx.host,"-p",ctx.port,"-U",ctx.user];}
export function dumpEphemeralDatabase(ctx,env=process.env){
  const raw=pgCommand("pg_dump",[
    ...baseArgs(ctx),"-Fc","--no-owner","--no-acl","-d",ctx.database
  ],{env,output:true});
  if(!Buffer.isBuffer(raw)||raw.length>MAX_BACKUP_BYTES||raw.length<5)
    fail("synthetic_backup_size_invalid");
  return raw;
}
export function createEphemeralRestoreDatabase(ctx,name,env=process.env){
  requireName(name);
  pgCommand("createdb",[...baseArgs(ctx),"-T","template0",name],{env});
}
export function restoreEphemeralDatabase(ctx,name,plaintext,env=process.env){
  requireName(name);
  if(!Buffer.isBuffer(plaintext)||plaintext.length>MAX_BACKUP_BYTES)
    fail("synthetic_backup_size_invalid");
  pgCommand("pg_restore",[
    ...baseArgs(ctx),"-Fc","--no-owner","--no-acl","-d",name
  ],{input:plaintext,env});
}
export function dropEphemeralRestoreDatabase(ctx,name,env=process.env){
  requireName(name);
  pgCommand("dropdb",[...baseArgs(ctx),"--if-exists",name],{env});
}
export function restoredDatabaseUri(databaseUrl,name){
  requireName(name);
  const u=new URL(databaseUrl);u.pathname="/"+name;
  return u.href;
}
export async function writeEncryptedFixtureSnapshot(dir,label,raw,key){
  if(!/^(pre|post)$/.test(label))fail("synthetic_backup_label_invalid");
  const blob=encryptFixtureBackup(raw,key);
  const path=join(dir,label+".savant-aead");
  await writeFile(path,blob,{mode:0o600,flag:"wx"});
  return {path,sha256:hash(blob),size:blob.length};
}
export async function readVerifiedFixtureSnapshot(ref,key){
  const blob=await readFile(ref.path);
  if(hash(blob)!==ref.sha256)fail("synthetic_backup_hash_mismatch");
  return decryptFixtureBackup(blob,key);
}
export async function withPrivateBackupDirectory(callback){
  const directory=await mkdtemp(join(tmpdir(),"savant-restore-ci-"));
  try{
    await chmod(directory,0o700);
    return await callback(directory);
  }finally{
    await rm(directory,{recursive:true,force:true});
  }
}
