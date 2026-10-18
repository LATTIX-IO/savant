import {readFile,readdir} from "node:fs/promises";
import {fileURLToPath} from "node:url";
import {resolve,join} from "node:path";

/** Reject mutable remote GitHub Action references across ALL workflow files.
 * A pull request may not replace an immutable SHA with vN, main, a dynamic
 * expression, a shortened SHA, or a remote Docker image in a uses: field.
 */
const pinned=/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.\/-]+)?@[0-9a-f]{40}$/;
export function inspectWorkflowPins(file,content){
  const findings=[],lines=content.split(/\r?\n/);
  let total=0;
  for(let i=0;i<lines.length;i++){
    const line=lines[i];
    const match=line.match(/^\s*(?:-\s*)?uses:\s*(.*)$/);
    if(!match)continue;
    const action=match[1].replace(/\s+#.*$/,"").trim();
    if(action.startsWith("./"))continue;
    total++;
    if(!pinned.test(action))findings.push({file,line:i+1,action});
  }
  return {total,findings};
}

/** All checkouts must erase git credentials after fetching. Untrusted
 * PR content or dependencies may run later in the same CI job.
 */
export function inspectCheckoutCredentials(file,content){
  const findings=[],lines=content.split(/\r?\n/);
  for(let i=0;i<lines.length;i++){
    const m=lines[i].match(/^(\s*)(?:-\s*)?uses:\s*actions\/checkout@/);
    if(!m)continue;
    const depth=m[1].length;
    let end=i+1;
    for(;end<lines.length;end++){
      const next=lines[end],indent=next.match(/^ */)[0].length;
      if(indent<=depth&&/^\s*-\s+(?:name|uses|run):/.test(next))break;
      if(indent<depth&&next.trim()&&!next.trim().startsWith("#"))break;
    }
    const step=lines.slice(i+1,end).join("\n");
    if(!/^\s+persist-credentials:\s*false(?:\s+#.*)?$/m.test(step))
      findings.push({file,line:i+1,action:"checkout_persisted_credentials"});
  }
  return findings;
}
const AGENT_SYNC_GUARD="github.event_name == 'workflow_dispatch' && inputs.apply == 'true' && github.ref == 'refs/heads/main' && github.repository == 'LATTIX-IO/savant' && vars.SAVANT_AGENT_STANDARDS_SYNC_ENABLED == 'true'";
export function inspectAgentStandardsBoundary(content){
  const file="agent-standards-sync.yml",issues=[];
  const fail=code=>issues.push({file,line:0,action:code});
  const header=content.split(/\njobs:\s*\n/)[0];
  const preview=content.match(/\n  preview:\s*\n([\s\S]*?)(?=\n  apply:\s*\n|$)/)?.[1];
  const apply=content.match(/\n  apply:\s*\n([\s\S]*)$/)?.[1];
  if(!/\npermissions:\s*\n\s{2}contents:\s*read(?:\n|$)/.test(header)||
    /^\s{2}push:/m.test(header))fail("agent_sync_untrusted_write_trigger");
  if(!/workflow_dispatch:\s*\n[\s\S]*?default:\s*'false'/.test(header))
    fail("agent_sync_dispatch_not_disabled");
  if(!preview||preview.includes("LATTIX_BOT_PAT")||
    !/token:\s*\$\{\{\s*github\.token\s*\}\}/.test(preview))
    fail("agent_sync_preview_bot_token");
  const ifLine=apply?.split("\n").find(x=>/^    if: /.test(x));
  if(!apply||ifLine?.slice(8).trim()!==AGENT_SYNC_GUARD||
    !/^\s{4}environment:\s*savant-release\s*$/m.test(apply)||
    /^\s+contents:\s*write\s*$/m.test(apply))
    fail("agent_sync_unreviewed_apply");
  return issues;
}
/** Workflow-dispatch inputs are data; never interpolate a caller-controlled
 * URL directly into a shell source string where quotes can be broken.
 */
export function inspectSeoOriginBoundary(content){
  const file="seo-verify.yml",issues=[];
  if(!content.includes("SEO_VERIFY_ORIGIN: \${{ inputs.origin || 'https://savantskills.app' }}")||
    !content.includes('run: node ./scripts/seo/verify-live.mjs --origin "$SEO_VERIFY_ORIGIN"')||
    /run:[^\n]*\$\{\{\s*(?:inputs|github\.event\.inputs)\.origin/.test(content))
    issues.push({file,line:0,action:"seo_dispatch_shell_injection"});
  return issues;
}

export async function verifyRepositoryWorkflows(root){
  const dir=join(root,".github","workflows");
  const files=(await readdir(dir)).filter(x=>/\.ya?ml$/.test(x)).sort();
  if(files.length===0)throw Error("No GitHub Actions workflow files found.");
  const findings=[];
  let total=0;
  for(const name of files){
    const source=await readFile(join(dir,name),"utf8");
    const {total:n,findings:bad}=inspectWorkflowPins(name,source);
    total+=n;
    findings.push(...bad,...inspectCheckoutCredentials(name,source));
    if(name==="agent-standards-sync.yml")
      findings.push(...inspectAgentStandardsBoundary(source));
    if(name==="seo-verify.yml")
      findings.push(...inspectSeoOriginBoundary(source));
  }
  return {workflowCount:files.length,remoteActions:total,findings};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const result=await verifyRepositoryWorkflows(process.cwd());
  if(result.findings.length){
    for(const entry of result.findings)
      console.error("Workflow security finding at "+entry.file+":"+entry.line+
        " ("+entry.action+")");
    process.exitCode=1;
  }else console.log("Immutable actions and checkout/dispatch boundaries verified: "+
    result.remoteActions+" actions across "+result.workflowCount+" workflows.");
}
