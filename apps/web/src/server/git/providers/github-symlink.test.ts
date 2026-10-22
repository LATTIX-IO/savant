import test from "node:test";
import assert from "node:assert/strict";
import {createGitHubProvider} from "./github.ts";
import {createRuntimeCredential} from "../types.ts";

test("PER-1610 provider mode guard excludes GitHub symbolic links and submodules from the file tree",async()=>{
 const provider=createGitHubProvider({env:{}});
 const credential=createRuntimeCredential({
  provider:"github",connectionId:"test",organizationId:"tenant-a",
  apiBaseUrl:"https://api.github.com",host:"github.com",accessToken:"synthetic-not-real",
 });
 const locator={provider:"github" as const,host:"github.com",owner:"example",name:"repo",
  fullName:"example/repo",providerRepositoryId:"123"};
 const sha="c".repeat(40);
 const observed:string[]=[];
 const fetcher=async(url:string|URL)=>{
  observed.push(String(url));
  return new Response(JSON.stringify({truncated:false,tree:[
   {path:"tier2/review/SKILL.md",type:"blob",mode:"100644",size:50},
   {path:"tier2/review/scripts/check.sh",type:"blob",mode:"100755",size:80},
   {path:"tier2/review/references/symlink.md",type:"blob",mode:"120000",size:27},
   {path:"tier2/review/references/unknown.md",type:"blob",size:30},
   {path:"tier2/review/vendor",type:"commit",mode:"160000"},
   {path:"tier2/review/references",type:"tree",mode:"040000"},
  ]}),{status:200,headers:{"content-type":"application/json"}});
 };
 const tree=await provider.listTree(credential,locator,sha,{fetcher});
 assert.deepEqual(tree.map(x=>x.path),[
  "tier2/review/SKILL.md","tier2/review/scripts/check.sh","tier2/review/references",
 ]);
 assert.equal(tree.some(x=>x.path.includes("symlink")||x.path.includes("unknown")),false);
 assert.equal(observed.length,1);
 assert.ok(observed[0]?.includes("/git/trees/"+sha));
});
