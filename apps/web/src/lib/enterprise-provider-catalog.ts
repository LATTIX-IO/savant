/** PER-1608. This is a product capability catalog, NEVER a grant inventory.
 * No row implies registered OAuth clients, active subscriptions, or observed usage.
 */
export type EnterpriseProviderId="openai"|"anthropic"|"microsoft";
export type EnterpriseCapability="api-inference"|"managed-skills"|"mcp-client"|"compliance"|"native-agent-deployment";
export type CapabilityDisposition="requires-authorization"|"requires-provider-eligibility"|"provider-specific";
export type EnterpriseProviderSurface={
  id:EnterpriseProviderId; name:string; consoleUrl:string;
  surfaces:readonly {id:EnterpriseCapability;name:string;disposition:CapabilityDisposition;prerequisite:string}[];
};
export const ENTERPRISE_PROVIDER_CATALOG:readonly EnterpriseProviderSurface[]=[
 {id:"openai",name:"OpenAI / ChatGPT / Codex",consoleUrl:"https://platform.openai.com/settings/organization",
  surfaces:[
   {id:"api-inference",name:"OpenAI API project",disposition:"requires-authorization",prerequisite:"Separate API Platform project and server-held service credential; ChatGPT seats do not authorize API billing."},
   {id:"managed-skills",name:"ChatGPT managed skills",disposition:"provider-specific",prerequisite:"Confirm workspace plan, administrator rights and supported publishing interface."},
   {id:"mcp-client",name:"ChatGPT to Savant MCP",disposition:"requires-authorization",prerequisite:"Deploy scoped Savant OAuth resource server before ChatGPT workspace installation."},
   {id:"compliance",name:"ChatGPT Enterprise compliance",disposition:"requires-provider-eligibility",prerequisite:"Enterprise entitlement, admin consent and separate restricted data capture policy."}
  ]},
 {id:"anthropic",name:"Anthropic / Claude / Claude Code",consoleUrl:"https://console.anthropic.com/",
  surfaces:[
   {id:"api-inference",name:"Claude API workspace",disposition:"requires-authorization",prerequisite:"Anthropic Console API workspace with isolated API key or approved workload federation."},
   {id:"managed-skills",name:"Claude organization skills",disposition:"provider-specific",prerequisite:"Confirm Team/Enterprise entitlement and provider-supported administration."},
   {id:"mcp-client",name:"Claude to Savant MCP",disposition:"requires-authorization",prerequisite:"Deploy scoped Savant MCP authorization and authorize the managed Claude connector."},
   {id:"compliance",name:"Claude Enterprise compliance",disposition:"requires-provider-eligibility",prerequisite:"Enterprise compliance access, separate data authorization and coverage verification."}
  ]},
 {id:"microsoft",name:"Microsoft 365 Copilot",consoleUrl:"https://entra.microsoft.com/",
  surfaces:[
   {id:"native-agent-deployment",name:"Copilot agents",disposition:"provider-specific",prerequisite:"Entra tenant, Copilot entitlement and supported Copilot Studio/Teams deployment path."},
   {id:"mcp-client",name:"Copilot to Savant tools",disposition:"provider-specific",prerequisite:"Validate supported connector, agent and admin consent flow; not universal MCP access."},
   {id:"compliance",name:"Copilot interaction export",disposition:"requires-authorization",prerequisite:"Graph application permission and consent, licensing and approved retention. Copilot Studio agent activity is a distinct source."}
  ]}
] as const;
export function describeEnterpriseProviderPreflight(){
 return ENTERPRISE_PROVIDER_CATALOG.map(p=>({
  id:p.id,name:p.name,consoleUrl:p.consoleUrl,connectionState:"unconfigured" as const,
  grantVerified:false,grantSource:"none" as const,
  surfaces:p.surfaces.map(s=>({...s,authorized:false,verified:false,coverage:"unknown" as const}))
 }));
}
