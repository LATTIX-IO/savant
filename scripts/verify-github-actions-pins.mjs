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
    const match=line.match(/^\s*(?:-\s*)?uses:\s*(\S+)(?:\s+#.*)?\s*$/);
    if(!match)continue;
    const action=match[1];
    if(action.startsWith("./"))continue;
    total++;
    if(!pinned.test(action))findings.push({file,line:i+1,action});
  }
  return {total,findings};
}
export async function verifyRepositoryWorkflows(root){
  const dir=join(root,".github","workflows");
  const files=(await readdir(dir)).filter(x=>/\.ya?ml$/.test(x)).sort();
  if(files.length===0)throw Error("No GitHub Actions workflow files found.");
  const findings=[];
  let total=0;
  for(const name of files){
    const {total:n,findings:bad}=inspectWorkflowPins(
      name,await readFile(join(dir,name),"utf8"));
    total+=n;findings.push(...bad);
  }
  return {workflowCount:files.length,remoteActions:total,findings};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const result=await verifyRepositoryWorkflows(process.cwd());
  if(result.findings.length){
    for(const entry of result.findings)
      console.error("Unpinned action at "+entry.file+":"+entry.line+
        " ("+entry.action+")");
    process.exitCode=1;
  }else console.log("Immutable GitHub action references verified: "+
    result.remoteActions+" actions across "+result.workflowCount+" workflows.");
}
