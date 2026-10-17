import {timingSafeEqual} from "node:crypto";

/** PER-1551: readiness-only check. Never log, persist or transmit key material.
 * Does NOT implement key rotation, keyring fallback or key provisioning.
 */
type Env=Record<string,string|undefined>;
type KeyName="TEST_BENCH_ENCRYPTION_KEY"|"AI_CONNECTION_ENCRYPTION_KEY";
export type ManagedKeyReadiness={
  ready:boolean;
  missing:KeyName[];
  invalid:KeyName[];
  domainsDistinct:boolean;
  versionedDualReadSupported:false;
  managedProvisioningVerified:false;
};
const names:readonly KeyName[]=[
  "TEST_BENCH_ENCRYPTION_KEY","AI_CONNECTION_ENCRYPTION_KEY",
];
function decode(value:string,domain:KeyName):Buffer|null{
  if(value!==value.trim()||value.length===0)return null;
  if(/^[0-9a-f]{64}$/i.test(value))return Buffer.from(value,"hex");
  // Apply the approved canonical per-domain configuration contract.
  // This is intentionally stricter than permissive legacy base64 decoders.
  const codec=domain==="TEST_BENCH_ENCRYPTION_KEY"?"base64url":"base64";
  if(codec==="base64url"
    ?!/^[A-Za-z0-9_-]{43}$/.test(value)
    :!/^[A-Za-z0-9+/]{43}=$/.test(value))return null;
  const decoded=Buffer.from(value,codec);
  if(decoded.byteLength!==32||decoded.toString(codec)!==value)return null;
  return decoded;
}
/** This checks material shape and segregation, NOT Vercel target/rotation or
 * KMS provenance. Keep reported results strictly boolean/name-only.
 */
export function inspectManagedKeyReadiness(env:Env):ManagedKeyReadiness{
  const missing:KeyName[]=[],invalid:KeyName[]=[];
  const valid=new Map<KeyName,Buffer>();
  for(const key of names){
    const raw=env[key];
    if(raw===undefined||raw===""){missing.push(key);continue;}
    const decoded=decode(raw,key);
    if(!decoded){invalid.push(key);continue;}
    valid.set(key,decoded);
  }
  const a=valid.get(names[0]!),b=valid.get(names[1]!);
  const domainsDistinct=!!a&&!!b&&!timingSafeEqual(a,b);
  return {
    ready:missing.length===0&&invalid.length===0&&domainsDistinct,
    missing,invalid,domainsDistinct,
    versionedDualReadSupported:false,managedProvisioningVerified:false,
  };
}
