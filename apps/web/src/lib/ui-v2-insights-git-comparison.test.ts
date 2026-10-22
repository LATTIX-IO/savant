import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import type {SkillListItem,VersionHistoryItem} from "@savant/types";
import {recordedGitCompareUrl,recordedGitRevisionOptions} from "./ui-v2-insights-git-comparison.ts";

const skill={repo:"LATTIX-IO/lattix-skills",repoProvider:"github"} as SkillListItem;
const a="a".repeat(40),b="b".repeat(40);
const versions=[
 {ref:"v1.0.0",commit:a,channel:"production"},
 {ref:"v1.1.0",commit:b,channel:"candidate"},
] as VersionHistoryItem[];
test("PER-1621 two distinct recorded exact Git revisions create a read-only provider compare URL",()=>{
 const opts=recordedGitRevisionOptions(skill,versions);
 assert.deepEqual(opts.map(o=>o.commit),[a,b]);
 const href=recordedGitCompareUrl(skill,versions,a,b);
 assert.equal(href,`https://github.com/LATTIX-IO/lattix-skills/compare/${a}...${b}`);
 const uri=new URL(href!);
 assert.equal(uri.protocol,"https:");
 assert.equal(uri.hostname,"github.com");
 assert.equal(uri.username,"");
 assert.equal(uri.password,"");
 assert.equal(uri.search,"");
 assert.equal(uri.hash,"");
});
test("PER-1621 no fabricated compare for same, unlisted, abbreviated or malformed commits",()=>{
 for(const [base,head] of [
  [a,a],[a,"c".repeat(40)],[a.slice(0,7),b],[a,"f".repeat(64)],
  ["../../other",b],["https://fake.com",b],
 ] as Array<[string,string]>)assert.equal(recordedGitCompareUrl(skill,versions,base,head),null,`${base}:${head}`);
 const forged=[...versions,{ref:"broken",commit:"b".repeat(7)},
  {ref:"dup",commit:a.toUpperCase()}] as VersionHistoryItem[];
 assert.deepEqual(recordedGitRevisionOptions(skill,forged).map(o=>o.commit),[a,b]);
 assert.equal(recordedGitCompareUrl(skill,[versions[0]!],a,b),null);
});
test("PER-1621 provider and repository safety preflight keeps links on official GitHub only",()=>{
 const otherHosts=[
  "evil.example/../safe","github.com/safe/repo","a/b?user=evil","a/b#fragment",
  "-flag/repo",".git/repo","a/..","../repo","a/%2Fother","a/b\\c",
 ] as string[];
 for(const repo of otherHosts){
  assert.equal(recordedGitCompareUrl({...skill,repo},versions,a,b),null,repo);
 }
 assert.deepEqual(recordedGitRevisionOptions({...skill,repoProvider:"gitlab"},versions),[]);
 assert.equal(recordedGitCompareUrl({...skill,repoProvider:"gitlab"},versions,a,b),null);
});
test("PER-1621 Insights offers authentic pinned comparison and preserves QA contract distinction",()=>{
 const ui=readFileSync(fileURLToPath(new URL("../components/savant/screens/insights-v2.tsx",import.meta.url)),"utf8");
 const css=readFileSync(fileURLToPath(new URL("../components/savant/screens/insights-v2.module.css",import.meta.url)),"utf8");
 assert.match(ui,/recordedGitCompareUrl\(skill,history,base,head\)/);
 assert.match(ui,/recordedGitRevisionOptions\(skill,history\)/);
 assert.match(ui,/target="_blank" rel="noopener noreferrer"/);
 assert.match(ui,/repository-wide/);
 assert.match(ui,/not independently verified a skill-only/);
 assert.match(ui,/ObservedRunComparisonPanel/);
 assert.match(css,/\.gitCompareFields select:focus-visible/);
 assert.match(css,/@media\(max-width:680px\)/);
 assert.doesNotMatch(ui,/localStorage|sessionStorage|dangerouslySetInnerHTML|Math\.random|mockGit|fakeDiff/);
});
