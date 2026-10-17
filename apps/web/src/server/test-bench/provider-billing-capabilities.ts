import {createHash} from "node:crypto";
import {TestBenchError} from "./definition-contract.ts";

/** PER-1549: first-party public API surface evidence only.
 * NO provider billing export, invoice source or request-level financial match
 * is authenticated by this module. This is intentionally deny-by-default.
 */
export type PlatformBillingProvider="nim"|"jev";
export type ProviderApiContractEvidence={
  provider:PlatformBillingProvider;
  inferenceOrigin:string;
  inferencePath:string;
  publicReference:string;
  documentedUsage:"reported_tokens";
  commercialEntitlement:
    "nvidia_developer_preview_not_production_license"|
    "typesafe_account_credits_contract_specific";
  billingExport:"not_verified";
  invoiceRequestIdJoin:"not_verified";
  issuerAccountId:"not_verified";
  financialConfirmationAllowed:false;
};
export const BILLING_API_EVIDENCE={
  nim:{
    provider:"nim",inferenceOrigin:"https://integrate.api.nvidia.com",
    inferencePath:"/v1/chat/completions",
    publicReference:"https://docs.api.nvidia.com/nim/reference/llm-apis",
    documentedUsage:"reported_tokens",
    commercialEntitlement:"nvidia_developer_preview_not_production_license",
    billingExport:"not_verified",invoiceRequestIdJoin:"not_verified",
    issuerAccountId:"not_verified",financialConfirmationAllowed:false,
  },
  jev:{
    provider:"jev",inferenceOrigin:"https://api.typesafe.ai",
    inferencePath:"/v1/systemone",
    publicReference:"https://api.typesafe.ai/openapi.json",
    documentedUsage:"reported_tokens",
    commercialEntitlement:"typesafe_account_credits_contract_specific",
    billingExport:"not_verified",invoiceRequestIdJoin:"not_verified",
    issuerAccountId:"not_verified",financialConfirmationAllowed:false,
  },
} as const satisfies Record<PlatformBillingProvider,ProviderApiContractEvidence>;
const fail=(code:string,status=409):never=>{throw new TestBenchError(code,status);};
/** Financial confirmation may only be enabled by a future vetted adapter with
 * source authentication, exact account binding and provider request identity.
 * This deliberately has no externally assertable 'verified' argument.
 */
export function denyUnsupportedProviderSettlement(provider:PlatformBillingProvider):never{
  if(!Object.hasOwn(BILLING_API_EVIDENCE,provider))
    return fail("test_bench_billing_provider_invalid",422);
  return fail("test_bench_provider_invoice_authentication_unavailable",409);
}
export type DiscoveryAttestation={
  provider:PlatformBillingProvider;
  sourceUrl:string;
  sourceSha256:string;
  documentedPaths:ReadonlyArray<string>;
  billingEndpointAttested:false;
  requestIdJoinAttested:false;
  actualChargeMicroUsd:null;
};
/** Even a plausible OpenAPI description is NOT an invoice or signed contract.
 * Restrict documentation to the exact first-party API origin; don't confuse
 * a model's response.id with an invoice transaction ID.
 */
export function inspectPublishedApiContract(input:{
  provider:PlatformBillingProvider;sourceUrl:string;
  rawBytes:Uint8Array;
}):DiscoveryAttestation{
  if(!Object.hasOwn(BILLING_API_EVIDENCE,input.provider))
    return fail("test_bench_billing_provider_invalid",422);
  // NVIDIA's pinned page is human-readable hosted API documentation, NOT an
  // authenticated invoice schema or machine-readable billing OpenAPI.
  if(input.provider==="nim")
    return fail("test_bench_nim_export_contract_undocumented",409);
  const expected=BILLING_API_EVIDENCE.jev.publicReference;
  if(input.sourceUrl!==expected||
    !(input.rawBytes instanceof Uint8Array)||
    input.rawBytes.byteLength<2||input.rawBytes.byteLength>262_144)
    return fail("test_bench_billing_documentation_invalid",422);
  let doc:unknown;
  try{doc=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(input.rawBytes));}
  catch{return fail("test_bench_billing_documentation_invalid",422);}
  if(!doc||typeof doc!=="object"||Array.isArray(doc))
    return fail("test_bench_billing_documentation_invalid",422);
  const paths=(doc as Record<string,unknown>).paths;
  const documentedPaths:string[]=[];
  if(paths!==undefined){
    if(!paths||typeof paths!=="object"||Array.isArray(paths))
      return fail("test_bench_billing_documentation_invalid",422);
    for(const path of Object.keys(paths)){
      if(path.length>256||!path.startsWith("/")||documentedPaths.length>=128)
        return fail("test_bench_billing_documentation_invalid",422);
      documentedPaths.push(path);
    }
  }
  // The inference API contains model response IDs and usage counts, which
  // are diagnostics ONLY. No source described here has been authenticated
  // as a provider billing API for Savant's actual account.
  return {
    provider:input.provider,sourceUrl:expected,
    sourceSha256:createHash("sha256").update(input.rawBytes).digest("hex"),
    documentedPaths:documentedPaths.sort(),
    billingEndpointAttested:false,requestIdJoinAttested:false,
    actualChargeMicroUsd:null,
  };
}
