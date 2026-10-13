import {createHash} from "node:crypto";
import type {ChatClient,JudgeClient,JevAnswer} from "../ai/clients.ts";
import {DEFAULT_RUBRIC,scoringQuestions,verdictFor} from "../evaluation/eval-generation.ts";
import {computeScorecard,type EvalSample,type Scorecard} from "../evaluation/scorecard.ts";
import type {TestBenchCase} from "./definition-contract.ts";

/** Deliberately bounded FIRST execution adapter: real NIM chat + Jev only.
 * External harness tools and MCP require their own authenticated executor.
 */
export const MAX_OBSERVED_CASES=4;
export const MAX_OBSERVED_TOKENS=12_000;
export const MAX_OBSERVED_COST_USD=0.05;
export const MAX_SKILL_INSTRUCTIONS_BYTES=12_000;
const NIM_USD_PER_MILLION_TOKENS=0.5;
/** Every stored comparison must carry the exact scoring contract that produced
 * it. Never reinterpret a historical run under a new rubric/version.
 */
export const OBSERVED_SCORING_FINGERPRINT=createHash("sha256")
  .update("savant:chat-only:jev-scorecard-algorithm:v1:")
  .update(JSON.stringify(DEFAULT_RUBRIC)).digest("hex");
export class ObservedEvaluationError extends Error{
  readonly code:string;
  constructor(code:string){super(code);this.name="ObservedEvaluationError";this.code=code;}
}
const reject=(code:string):never=>{throw new ObservedEvaluationError(code);};
export type ObservedCase=EvalSample&{
  kind:TestBenchCase["kind"];expectedMet:number;output:string;
  executionModel:string;judgeModel:string;
};
export type ObservedEvaluation={
  samples:ObservedCase[];scorecard:Scorecard;
  totalTokens:number;estimatedCostUsd:number;
  executionModel:string;judgeModel:string;
};
function score(answer:JevAnswer|undefined):number{
  if(!answer||answer.type!=="score")return reject("test_bench_judge_score_invalid");
  if(!Number.isFinite(answer.score)||answer.score<0||answer.score>4)
    return reject("test_bench_judge_score_invalid");
  return answer.score/4;
}
function binary(answer:JevAnswer|undefined):number{
  if(!answer||answer.type!=="noul")return reject("test_bench_judge_binary_invalid");
  if(!Number.isFinite(answer.noul)||answer.noul<0||answer.noul>1)
    return reject("test_bench_judge_binary_invalid");
  return answer.noul;
}
function revisions(answer:JevAnswer|undefined):number{
  if(!answer||answer.type!=="choice")return reject("test_bench_judge_revision_invalid");
  if(!["0","1","2","3"].includes(answer.choice)||
    !Number.isFinite(answer.confidence)||answer.confidence<0||answer.confidence>1)
    return reject("test_bench_judge_revision_invalid");
  return Number(answer.choice);
}
function tokens(input:{promptTokens?:number;completionTokens?:number;inputTokens?:number;outputTokens?:number}):number{
  const a=input.promptTokens??input.inputTokens,b=input.completionTokens??input.outputTokens;
  // Unknown token accounting must never be passed off as zero-cost evidence.
  if(!Number.isSafeInteger(a)||!Number.isSafeInteger(b)||
    (a as number)<0||(b as number)<0||(a as number)+(b as number)<=0)
    reject("test_bench_provider_usage_missing");
  return (a as number)+(b as number);
}
function round(value:number):number{return Math.round(value*10_000)/10_000;}

/** Throws on partial/missing judge responses; never synthesizes a pass or runtime. */
export async function executeObservedCases(
  input:{
    skillName:string;instructions:string;cases:readonly TestBenchCase[];
    clients:{executor:ChatClient;judge:JudgeClient};
    onCase?:(sample:ObservedCase,index:number,total:number)=>Promise<void>;
    beforeCase?:(index:number)=>Promise<void>;
    beforeJudge?:(index:number)=>Promise<void>;
    maxTokens?:number;maxUsd?:number;costPerMillionTokens?:number;
  },
):Promise<ObservedEvaluation>{
  const {skillName,instructions,cases,clients}=input;
  if(cases.length<1||cases.length>MAX_OBSERVED_CASES)reject("test_bench_execution_case_limit");
  if(!instructions.trim()||new TextEncoder().encode(instructions).length>MAX_SKILL_INSTRUCTIONS_BYTES)
    reject("test_bench_skill_instructions_unsupported");
  const ceiling=input.maxTokens??MAX_OBSERVED_TOKENS;
  const maxUsd=input.maxUsd??MAX_OBSERVED_COST_USD;
  const perMillion=input.costPerMillionTokens??NIM_USD_PER_MILLION_TOKENS;
  if(!Number.isSafeInteger(ceiling)||ceiling<1||ceiling>MAX_OBSERVED_TOKENS||
    !Number.isFinite(maxUsd)||maxUsd<=0||maxUsd>MAX_OBSERVED_COST_USD||
    !Number.isFinite(perMillion)||perMillion<=0||perMillion>100)
    reject("test_bench_budget_invalid");
  const observed:ObservedCase[]=[];
  let totalTokens=0;
  let estimatedCostUsd=0;
  for(const [index,item] of cases.entries()){
    await input.beforeCase?.(index+1);
    const prompt=item.context?`${item.prompt}\n\nContext:\n${item.context}`:item.prompt;
    const completion=await clients.executor.complete([
      {role:"system",content:`Evaluate the following chat-only skill instructions. No tools or external actions are available.\n<skill name=${JSON.stringify(skillName)}>\n${instructions}\n</skill>`},
      {role:"user",content:prompt},
    ],{maxTokens:400,temperature:0.2,timeoutMs:15_000});
    if(!completion.content.trim()||completion.content.length>3_000||
      !Number.isFinite(completion.latencyMs)||completion.latencyMs<0)
      reject("test_bench_model_output_invalid");
    const executedTokens=tokens(completion.usage);
    totalTokens+=executedTokens;
    estimatedCostUsd=totalTokens*perMillion/1_000_000;
    if(totalTokens>ceiling||estimatedCostUsd>maxUsd)reject("test_bench_budget_exceeded");
    await input.beforeJudge?.(index+1);
    const judged=await clients.judge.ask({
      skill:{name:skillName,instructions},
      case:{kind:item.kind,prompt:item.prompt,context:item.context,expected_behavior:item.expectedBehavior},
      output:completion.content,
    },scoringQuestions(),{timeoutMs:10_000});
    totalTokens+=tokens(judged.usage);
    estimatedCostUsd=totalTokens*perMillion/1_000_000;
    if(totalTokens>ceiling||estimatedCostUsd>maxUsd)reject("test_bench_budget_exceeded");
    const a=judged.answers;
    const expectedMet=binary(a.expected_met);
    const rev=revisions(a.revisions);
    const sampleBase:Omit<EvalSample,"verdict">={
      caseId:item.caseId,prompt:item.prompt,
      quality:score(a.quality),formatCompliance:score(a.format_compliance),
      policyCompliance:binary(a.policy_compliance)>=0.5,
      groundingRelevant:binary(a.grounding_relevant)>=0.5,
      groundingScore:score(a.grounding_score),actionability:score(a.actionability),
      latencyMs:completion.latencyMs,estimatedCostUsd:round((executedTokens+tokens(judged.usage))*perMillion/1_000_000),
      humanRevisionCount:rev,
    };
    const sample:ObservedCase={
      ...sampleBase,verdict:verdictFor(sampleBase,expectedMet,DEFAULT_RUBRIC),
      kind:item.kind,expectedMet,
      output:completion.content.slice(0,2000),
      executionModel:completion.model,judgeModel:judged.model,
    };
    observed.push(sample);
    await input.onCase?.(sample,index+1,cases.length);
  }
  if(observed.length!==cases.length)reject("test_bench_incomplete");
  const scorecard=computeScorecard(observed,DEFAULT_RUBRIC);
  return {
    samples:observed,scorecard,totalTokens,estimatedCostUsd:round(estimatedCostUsd),
    executionModel:clients.executor.model,judgeModel:clients.judge.model,
  };
}
