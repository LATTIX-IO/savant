import {TestBenchClientError} from "./test-bench-client.ts";

export type TestBenchAvailabilityKind=
 "schema-unavailable"|"key-unavailable"|"access-denied"|"temporarily-unavailable"|"not-found"|"unexpected";
export type TestBenchAvailability={
 kind:TestBenchAvailabilityKind;
 heading:string;
 explanation:string;
};
export function classifyTestBenchAvailability(error:unknown):TestBenchAvailability{
 const status=error instanceof TestBenchClientError?error.status:null;
 const code=error instanceof TestBenchClientError?error.code:null;
 if(status===401||status===403)return {
  kind:"access-denied",heading:"Test cases require workspace permission",
  explanation:"Your current session is not authorized to read the selected skill's saved Test Bench cases. Check your workspace access; no case data was returned.",
 };
 if(status===503&&code==="test_bench_schema_unavailable")return {
  kind:"schema-unavailable",heading:"Encrypted Test Bench storage is not active",
  explanation:"The server reported that the required Test Bench database schema is unavailable. An authorized recovery and schema-activation process is required before saved case suites can be read or edited.",
 };
 if(status===503&&(code==="test_bench_key_unconfigured"||code==="test_bench_integrity_failure"))return {
  kind:"key-unavailable",heading:"Saved test cases cannot be decrypted",
  explanation:"The Test Bench encryption domain is not available or did not pass its integrity checks. An authorized operator must verify managed-key recovery. Existing case definitions are not assumed empty.",
 };
 if(status===503||status===502||status===504)return {
  kind:"temporarily-unavailable",heading:"Test Bench service is unavailable",
  explanation:"Encrypted suite storage or evaluation execution is not operational for this request. Verify production schema, managed-key readiness and service health. Do not interpret the response as an empty suite.",
 };
 if(status===404)return {
  kind:"not-found",heading:"Saved Test Bench records unavailable",
  explanation:"The selected resource was not found or cannot be accessed. Recheck the authorized skill and current workspace; no saved cases are inferred.",
 };
 return {
  kind:"unexpected",heading:"Could not load saved test cases",
  explanation:"The authorized Test Bench request did not complete. Retry or review application diagnostics without exposing private data.",
 };
}
