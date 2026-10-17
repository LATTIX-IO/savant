import {Buffer} from "node:buffer";
import {timingSafeEqual} from "node:crypto";

/** Server-only, bounded AES-256-GCM key selection.
 * Existing v1 content has NO key id; a separate legacy key is mandatory when
 * v2 writes are enabled. Key bytes never appear in exceptions or telemetry.
 */
export class VersionedKeyringError extends Error{
  constructor(){
    super("managed encryption keys are unavailable");
    this.name="VersionedKeyringError";
  }
}
export type DomainKeyringConfig={
  activeEnv:string;
  activeIdEnv:string;
  previousEnv:string;
  legacyEnv:string;
  encoding:"base64url"|"base64";
};
export type DomainKeyring={
  activeKey:Buffer;
  activeId:string|null;
  legacyKey:Buffer;
  previous:ReadonlyMap<string,Buffer>;
};
const KID=/^[a-z][a-z0-9_-]{0,31}$/;
const HEX=/^[0-9a-fA-F]{64}$/;
function decodeKey(input:unknown,encoding:"base64url"|"base64"):Buffer{
  if(typeof input!=="string"||!input||input!==input.trim()||
    input.length>128)throw new VersionedKeyringError();
  if(HEX.test(input))return Buffer.from(input,"hex");
  const syntax=encoding==="base64url"
    ?/^[A-Za-z0-9_-]{43}$/
    :/^[A-Za-z0-9+/]{43}=$/;
  if(!syntax.test(input))throw new VersionedKeyringError();
  const value=Buffer.from(input,encoding);
  if(value.length!==32||value.toString(encoding)!==input)
    throw new VersionedKeyringError();
  return value;
}
export function readKeyring(env:Record<string,string|undefined>,
  cfg:DomainKeyringConfig):DomainKeyring{
  const activeKey=decodeKey(env[cfg.activeEnv],cfg.encoding);
  const id=env[cfg.activeIdEnv];
  if(id!==undefined&&!KID.test(id))throw new VersionedKeyringError();
  const previous=new Map<string,Buffer>();
  const rawPrevious=env[cfg.previousEnv];
  if(rawPrevious!==undefined){
    if(!id||rawPrevious.length>4096)throw new VersionedKeyringError();
    let data:unknown;
    try{data=JSON.parse(rawPrevious);}catch{throw new VersionedKeyringError();}
    if(!data||typeof data!=="object"||Array.isArray(data))
      throw new VersionedKeyringError();
    const entries=Object.entries(data);
    if(entries.length>8)throw new VersionedKeyringError();
    for(const [previousId,raw] of entries){
      if(!KID.test(previousId)||previousId===id)
        throw new VersionedKeyringError();
      const candidate=decodeKey(raw,cfg.encoding);
      if(timingSafeEqual(candidate,activeKey))
        throw new VersionedKeyringError();
      previous.set(previousId,candidate);
    }
  }
  // Prevent v2 activation before retaining the v1 key in separately managed
  // escrow. In a legacy-only environment, v1 uses the active key as before.
  if(id&&!env[cfg.legacyEnv])throw new VersionedKeyringError();
  const legacyKey=env[cfg.legacyEnv]
    ?decodeKey(env[cfg.legacyEnv],cfg.encoding):activeKey;
  // Without v2 framing a new v1 write MUST use the exact same key as a
  // subsequent v1 read. A different legacy key is unsafe until key IDs exist.
  if(!id&&!timingSafeEqual(legacyKey,activeKey))
    throw new VersionedKeyringError();
  return {activeKey,activeId:id??null,legacyKey,previous};
}
/** v2 ciphertext lookup is by authenticated ID only; no brute-force fallback. */
export function selectV2Key(keyring:DomainKeyring,kid:string):Buffer{
  if(!KID.test(kid))throw new VersionedKeyringError();
  if(keyring.activeId===kid)return keyring.activeKey;
  const key=keyring.previous.get(kid);
  if(!key)throw new VersionedKeyringError();
  return key;
}
