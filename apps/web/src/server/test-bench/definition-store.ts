import {createHash,randomUUID} from "node:crypto";
import type {GitActor} from "../git/access-control.ts";
import {assertGitPermission} from "../git/access-control.ts";
import {requirePinnedEvaluationCommit} from "../jobs/eval-source-revision.ts";
import {
  TestBenchError,parseTestBenchCases,
  type TestBenchCase,type TestBenchDefinition,type TestBenchDraft,
} from "./definition-contract.ts";
import {encryptTestBenchCases,decryptTestBenchCases} from "./definition-crypto.ts";

type Sql=import("postgres").Sql;
type Row={
  id:string;organization_id:string;repository_id:string;skill_id:string;
  source_path:string;source_commit_sha:string;name:string;cases_ciphertext:string;
  revision:number;create_request_id:string;request_digest:string;created_by:string;
  updated_by:string;created_at:Date|string;updated_at:Date|string;
  archived_at:Date|string|null;
};
function fail(code:string,status=404):never{throw new TestBenchError(code,status);}
function iso(value:Date|string):string{return value instanceof Date?value.toISOString():new Date(value).toISOString();}
function digest(skillId:string,draft:TestBenchDraft):string{
  return createHash("sha256").update(JSON.stringify({skillId,name:draft.name,cases:draft.cases})).digest("hex");
}
function asDefinition(row:Row):TestBenchDefinition{
  let cases:TestBenchCase[];
  try{
    const plain=decryptTestBenchCases(row.cases_ciphertext,{
      organizationId:row.organization_id,definitionId:row.id,
      revision:row.revision,commitSha:row.source_commit_sha,
    });
    cases=parseTestBenchCases(JSON.parse(plain));
  }catch(error){
    if(error instanceof TestBenchError&&error.code==="test_bench_key_unconfigured")throw error;
    fail("test_bench_integrity_failure",503);
  }
  return {id:row.id,skillId:row.skill_id,sourceCommitSha:row.source_commit_sha,
    name:row.name,cases,revision:row.revision,
    createdAt:iso(row.created_at),updatedAt:iso(row.updated_at)};
}
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function validateId(value:string):string{
  if(!UUID.test(value))fail("test_bench_not_found");
  return value;
}
function validateSkillId(value:string):string{
  if(!value||value.length>300||value.trim()!==value)fail("test_bench_skill_invalid",422);
  return value;
}
function assertActor(actor:GitActor,write:boolean):void{
  if(!actor.organizationId||!actor.subject)fail("auth_required",401);
  assertGitPermission(actor,write?"connect_repository":"view");
}
/** All persisted definitions are encrypted and bound to an immutable indexed source commit. */
export function createTestBenchDefinitionStore(sql:Sql){
  return {
    async list(actor:GitActor,skillId:string):Promise<TestBenchDefinition[]>{
      assertActor(actor,false);validateSkillId(skillId);
      const rows=await sql<Row[]>`
        select * from test_bench_definitions
        where organization_id=${actor.organizationId} and skill_id=${skillId}
          and archived_at is null
        order by updated_at desc,id
        limit 51
      `;
      if(rows.length>50)fail("test_bench_definition_limit",409);
      return rows.map(asDefinition);
    },
    async get(actor:GitActor,skillId:string,id:string):Promise<TestBenchDefinition>{
      assertActor(actor,false);validateSkillId(skillId);validateId(id);
      const [row]=await sql<Row[]>`
        select * from test_bench_definitions
        where organization_id=${actor.organizationId}
          and skill_id=${skillId} and id=${id} and archived_at is null
      `;
      if(!row)fail("test_bench_not_found");
      return asDefinition(row);
    },
    async create(actor:GitActor,skillId:string,input:TestBenchDraft&{requestId:string}):
      Promise<{definition:TestBenchDefinition;replayed:boolean}>{
      assertActor(actor,true);validateSkillId(skillId);
      const hash=digest(skillId,input);
      return sql.begin(async tx=>{
        // Serialize new definition count and request-ID admission per workspace/skill.
        await tx`select pg_advisory_xact_lock(hashtext(${actor.organizationId}),hashtext(${skillId}))`;
        const [prior]=await tx<Row[]>`
          select * from test_bench_definitions
          where organization_id=${actor.organizationId} and create_request_id=${input.requestId}
          for update
        `;
        if(prior){
          if(prior.skill_id!==skillId||prior.request_digest!==hash||prior.archived_at)
            fail("test_bench_idempotency_conflict",409);
          return {definition:asDefinition(prior),replayed:true};
        }
        const [count]=await tx<{n:number}[]>`
          select count(*)::int as n from test_bench_definitions
          where organization_id=${actor.organizationId} and skill_id=${skillId}
            and archived_at is null
        `;
        if((count?.n??0)>=50)fail("test_bench_definition_limit",409);
        const [indexed]=await tx<{repository_id:string;source_path:string;source_commit_sha:string}[]>`
          select s.repository_id,s.source_path,s.source_commit_sha
          from indexed_skills s join repositories r
            on r.id=s.repository_id and r.organization_id=s.organization_id
          where s.organization_id=${actor.organizationId} and s.skill_id=${skillId}
            and r.status<>'disabled'
          order by s.last_indexed_at desc,s.id
          limit 1
        `;
        if(!indexed)fail("test_bench_source_not_indexed",409);
        let commitSha:string;
        try{commitSha=requirePinnedEvaluationCommit(indexed.source_commit_sha);}
        catch{fail("test_bench_source_not_pinned",409);}
        const id=randomUUID();
        const ciphertext=encryptTestBenchCases(JSON.stringify(input.cases),{
          organizationId:actor.organizationId,definitionId:id,revision:1,commitSha,
        });
        const [row]=await tx<Row[]>`
          insert into test_bench_definitions
            (id,organization_id,repository_id,skill_id,source_path,source_commit_sha,
             name,cases_ciphertext,revision,create_request_id,request_digest,created_by,updated_by)
          values (${id},${actor.organizationId},${indexed.repository_id},${skillId},
            ${indexed.source_path},${commitSha},${input.name},${ciphertext},1,
            ${input.requestId},${hash},${actor.subject},${actor.subject})
          returning *
        `;
        if(!row)fail("test_bench_storage_unavailable",503);
        await tx`
          insert into audit_events
          (organization_id,actor_type,actor_ref,category,action,target_type,target_ref,request_id,payload_redacted)
          values (${actor.organizationId},'user',${actor.subject},'evaluation',
            'test_bench_definition_created','test_bench_definition',${id},
            ${input.requestId},
            ${tx.json({revision:1,commitShaPrefix:commitSha.slice(0,12),caseCount:input.cases.length})}::jsonb)
        `;
        return {definition:asDefinition(row),replayed:false};
      });
    },
    async update(actor:GitActor,skillId:string,id:string,input:TestBenchDraft&{expectedRevision:number}):
      Promise<TestBenchDefinition>{
      assertActor(actor,true);validateSkillId(skillId);validateId(id);
      return sql.begin(async tx=>{
        const [existing]=await tx<Row[]>`
          select * from test_bench_definitions
          where organization_id=${actor.organizationId} and skill_id=${skillId}
            and id=${id} and archived_at is null
          for update
        `;
        if(!existing)fail("test_bench_not_found");
        if(existing.revision!==input.expectedRevision)fail("test_bench_revision_conflict",409);
        const nextRevision=existing.revision+1;
        const ciphertext=encryptTestBenchCases(JSON.stringify(input.cases),{
          organizationId:actor.organizationId,definitionId:id,
          revision:nextRevision,commitSha:existing.source_commit_sha,
        });
        const [row]=await tx<Row[]>`
          update test_bench_definitions set
            revision=${nextRevision},name=${input.name},cases_ciphertext=${ciphertext},
            updated_by=${actor.subject},updated_at=now()
          where organization_id=${actor.organizationId} and skill_id=${skillId}
            and id=${id} and revision=${input.expectedRevision}
            and archived_at is null
          returning *
        `;
        if(!row)fail("test_bench_revision_conflict",409);
        await tx`
          insert into audit_events
          (organization_id,actor_type,actor_ref,category,action,target_type,target_ref,payload_redacted)
          values (${actor.organizationId},'user',${actor.subject},'evaluation',
            'test_bench_definition_updated','test_bench_definition',${id},
            ${tx.json({revision:nextRevision,caseCount:input.cases.length})}::jsonb)
        `;
        return asDefinition(row);
      });
    },
    async archive(actor:GitActor,skillId:string,id:string,expectedRevision:number):
      Promise<{id:string;revision:number;archived:true}>{
      assertActor(actor,true);validateSkillId(skillId);validateId(id);
      return sql.begin(async tx=>{
        const [row]=await tx<Row[]>`
          select * from test_bench_definitions
          where organization_id=${actor.organizationId} and skill_id=${skillId}
            and id=${id} and archived_at is null
          for update
        `;
        if(!row)fail("test_bench_not_found");
        if(row.revision!==expectedRevision)fail("test_bench_revision_conflict",409);
        const nextRevision=row.revision+1;
        await tx`
          update test_bench_definitions set archived_at=now(),revision=${nextRevision},
            updated_by=${actor.subject},updated_at=now()
          where organization_id=${actor.organizationId} and id=${id}
        `;
        await tx`
          insert into audit_events
          (organization_id,actor_type,actor_ref,category,action,target_type,target_ref,payload_redacted)
          values (${actor.organizationId},'user',${actor.subject},'evaluation',
            'test_bench_definition_archived','test_bench_definition',${id},
            ${tx.json({revision:nextRevision})}::jsonb)
        `;
        return {id,revision:nextRevision,archived:true as const};
      });
    },
  };
}
