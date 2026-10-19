import process from "node:process";
import {inspectManagedKeyReadiness} from "../src/server/security/managed-key-readiness.ts";

/** Manual operator gate: no secret output, no network, no env-file writes.
 * Use only in an approved staging/production runtime with protected secrets.
 */
const result=inspectManagedKeyReadiness(process.env);
if(result.missing.length)console.error("Missing managed key names: "+result.missing.join(", "));
if(result.invalid.length)console.error("Invalid managed key shapes: "+result.invalid.join(", "));
if(!result.domainsDistinct)
  console.error("Independent encryption-domain keys could not be verified.");
console.log("Managed encryption key SHAPE preflight: "+(result.ready?"PASS":"BLOCKED"));
console.log("KMS provisioning, restoration and versioned dual-read: NOT VERIFIED");
if(!result.ready)process.exitCode=1;
