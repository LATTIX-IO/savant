"use client";

import {useEffect,useRef,useState} from "react";
import {extractWorkspaceSlugFromPathname} from "@/lib/tenant-paths";
import {ObservedTestBenchRunPanel} from "./observed-test-bench-run-panel";
import {ObservedRunComparisonPanel} from "./observed-run-comparison-panel";
import {
  listPersistedTestBenches,createPersistedTestBench,updatePersistedTestBench,
  archivePersistedTestBench,
} from "@/lib/test-bench-client";
import {
  parseTestBenchCases,type TestBenchCase,type TestBenchCaseKind,type TestBenchDefinition,
} from "@/server/test-bench/definition-contract";

const newCase=():TestBenchCase=>({
  caseId:"case-"+crypto.randomUUID().slice(0,8),kind:"positive",prompt:"",
  context:null,expectedBehavior:"",
});
const KINDS:TestBenchCaseKind[]=["positive","negative","edge","escalation"];
/** Durable case definitions; intentionally has no Run button until an actual executor ships. */
export function PersistedTestBench({
  skillId,pathname,readOnly,
}:{skillId:string;pathname:string;readOnly:boolean}){
  const slug=extractWorkspaceSlugFromPathname(pathname);
  const [definitions,setDefinitions]=useState<TestBenchDefinition[]>([]);
  const [selected,setSelected]=useState<TestBenchDefinition|null>(null);
  const [name,setName]=useState("My Test Bench cases");
  const [cases,setCases]=useState<TestBenchCase[]>([{caseId:"case-1",kind:"positive",prompt:"",context:null,expectedBehavior:""}]);
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState<string|null>(null);
  const [notice,setNotice]=useState<string|null>(null);
  const requestId=useRef<string|null>(null);
  const editable=!readOnly&&!!slug&&!busy;

  async function refresh(){
    if(!slug){setError("A workspace is required to access saved Test Bench cases.");setLoading(false);return;}
    setLoading(true);
    try{
      const records=await listPersistedTestBenches(skillId,{workspaceSlug:slug});
      setDefinitions(records);setError(null);
      if(selected){
        const current=records.find(item=>item.id===selected.id);
        if(current)setSelected(current);
      }
    }catch{
      setError("Saved Test Bench cases could not be loaded. Check workspace access and server encryption configuration.");
    }finally{setLoading(false);}
  }
  useEffect(()=>{
    if(!slug)return;
    const controller=new AbortController();
    void listPersistedTestBenches(skillId,{workspaceSlug:slug,signal:controller.signal})
      .then(items=>{if(!controller.signal.aborted){setDefinitions(items);setError(null);}})
      .catch(()=>{if(!controller.signal.aborted)setError("Saved Test Bench cases are not available in this workspace.");})
      .finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return ()=>controller.abort();
  },[skillId,slug]);
  function startNew(){
    if(!editable)return;
    requestId.current=null;setSelected(null);setName("New Test Bench");
    setCases([newCase()]);setNotice(null);setError(null);
  }
  function select(item:TestBenchDefinition){
    if(busy)return;
    requestId.current=null;setSelected(item);setName(item.name);
    setCases(item.cases.map(c=>({...c})));setNotice(null);setError(null);
  }
  function change(index:number,key:keyof TestBenchCase,value:string){
    requestId.current=null;
    setCases(current=>current.map((item,i)=>i===index?
      {...item,[key]:key==="context"?(value||null):value}:item));
  }
  async function save(){
    if(!editable||!slug)return;
    setBusy(true);setError(null);setNotice(null);
    try{
      const bounded=parseTestBenchCases(cases);
      const updated=selected
        ? await updatePersistedTestBench(skillId,selected.id,{
          name,cases:bounded,expectedRevision:selected.revision,
        },{workspaceSlug:slug})
        : await createPersistedTestBench(skillId,{
          name,cases:bounded,requestId:requestId.current??(requestId.current=crypto.randomUUID()),
        },{workspaceSlug:slug});
      setSelected(updated);setName(updated.name);setCases(updated.cases);
      setDefinitions(current=>[updated,...current.filter(x=>x.id!==updated.id)]);
      requestId.current=null;
      setNotice("Saved to this workspace at an immutable Git source revision. No cases have been executed.");
    }catch{
      setError("Could not save this case suite. Check the case fields, role, encryption configuration, or revision; reload if another editor changed it.");
    }finally{setBusy(false);}
  }
  async function archive(){
    if(!editable||!slug||!selected)return;
    if(!window.confirm("Archive this saved Test Bench suite?"))return;
    setBusy(true);setError(null);setNotice(null);
    try{
      await archivePersistedTestBench(skillId,selected.id,selected.revision,{workspaceSlug:slug});
      setDefinitions(current=>current.filter(item=>item.id!==selected.id));
      setSelected(null);setName("New Test Bench");setCases([newCase()]);
      requestId.current=null;setNotice("Saved suite archived. No evaluation was run.");
    }catch{
      setError("Could not archive this suite. Verify permissions or reload its latest revision.");
    }finally{setBusy(false);}
  }
  return (
    <section className="panel" aria-label="Workspace Test Bench case suites">
      <div className="panel-hd">
        <div>
          <div className="panel-title">Workspace Test Bench case suites</div>
          <div className="subtle" style={{fontSize:11.5}}>
            Versioned, encrypted case definitions shared across devices, pinned to one Git commit.
          </div>
        </div>
        <span className="chip chip-paper">Definition only</span>
      </div>
      <div className="panel-bd" style={{display:"grid",gap:14}}>
        <p className="subtle" style={{margin:0,fontSize:12}}>
          Saved case specifications are encrypted and versioned. Run the saved revision
          below through the chat-only provider evaluator; saving alone does not score or publish anything.
        </p>
        <div className="row" style={{gap:8,flexWrap:"wrap"}}>
          <button type="button" className="btn btn-sm btn-ghost" onClick={()=>void refresh()} disabled={loading||busy}>
            {slug&&loading?"Loading…":"Reload saved suites"}
          </button>
          <button type="button" className="btn btn-sm btn-primary" onClick={startNew} disabled={!editable}>
            New case suite
          </button>
        </div>
        {definitions.length?(
          <div style={{display:"grid",gap:6}}>
            {definitions.map(item=>(
              <button key={item.id} type="button" className="btn btn-sm btn-ghost"
                onClick={()=>select(item)} disabled={busy}
                style={{textAlign:"left",whiteSpace:"normal",display:"block"}}>
                {item.name} · {item.cases.length} cases · revision {item.revision}
              </button>
            ))}
          </div>
        ):(!loading?<p className="subtle" style={{margin:0}}>No saved workspace case suites.</p>:null)}
        <div style={{borderTop:"1px solid var(--rule)",paddingTop:14,display:"grid",gap:12}}>
          <div className="field">
            <label className="field-label" htmlFor="test-bench-suite-name">Suite name</label>
            <input id="test-bench-suite-name" value={name} maxLength={100} disabled={!editable}
              onChange={e=>{requestId.current=null;setName(e.target.value);}} />
          </div>
          {selected?(
            <div className="subtle mono" style={{fontSize:11,overflowWrap:"anywhere"}}>
              Source: {selected.sourceCommitSha} · Revision {selected.revision}
            </div>
          ):null}
          {cases.map((item,index)=>(
            <div key={item.caseId} style={{border:"1px solid var(--rule)",borderRadius:6,padding:12,display:"grid",gap:10}}>
              <div className="row" style={{justifyContent:"space-between",alignItems:"center"}}>
                <strong style={{fontSize:12}}>Case {index+1}</strong>
                <button type="button" className="btn btn-sm btn-ghost"
                  disabled={!editable||cases.length===1} onClick={()=>{
                    requestId.current=null;setCases(current=>current.filter((_,i)=>i!==index));
                  }}>Remove</button>
              </div>
              <div className="field">
                <label className="field-label" htmlFor={`bench-kind-${index}`}>Scenario</label>
                <select id={`bench-kind-${index}`} value={item.kind} disabled={!editable}
                  onChange={e=>change(index,"kind",e.target.value)}>
                  {KINDS.map(kind=><option key={kind} value={kind}>{kind}</option>)}
                </select>
              </div>
              <div className="field">
                <label className="field-label" htmlFor={`bench-prompt-${index}`}>User request or test prompt</label>
                <textarea id={`bench-prompt-${index}`} rows={3} maxLength={2000} value={item.prompt}
                  disabled={!editable} onChange={e=>change(index,"prompt",e.target.value)} />
              </div>
              <div className="field">
                <label className="field-label" htmlFor={`bench-expected-${index}`}>Expected behavior</label>
                <textarea id={`bench-expected-${index}`} rows={2} maxLength={1000} value={item.expectedBehavior}
                  disabled={!editable} onChange={e=>change(index,"expectedBehavior",e.target.value)} />
              </div>
              <div className="field">
                <label className="field-label" htmlFor={`bench-context-${index}`}>Optional safe context</label>
                <textarea id={`bench-context-${index}`} rows={2} maxLength={1500} value={item.context??""}
                  disabled={!editable} onChange={e=>change(index,"context",e.target.value)} />
              </div>
            </div>
          ))}
          <div className="row" style={{gap:8,flexWrap:"wrap"}}>
            <button type="button" className="btn btn-sm btn-ghost"
              disabled={!editable||cases.length>=8} onClick={()=>{
                requestId.current=null;setCases(current=>[...current,newCase()]);
              }}>Add case ({cases.length}/8)</button>
            <button type="button" className="btn btn-sm btn-primary" disabled={!editable}
              onClick={()=>void save()}>{busy?"Saving…":selected?"Save revision":"Save new suite"}</button>
            {selected?(
              <button type="button" className="btn btn-sm btn-ghost" disabled={!editable}
                onClick={()=>void archive()}>Archive suite</button>
            ):null}
          </div>
        </div>
        {(!slug||error)?<p role="alert" style={{fontSize:12,color:"var(--blood)",margin:0}}>{slug?error:"A workspace is required to load Test Bench cases."}</p>:null}
        {notice?<p role="status" style={{fontSize:12,margin:0}}>{notice}</p>:null}
        {selected&&slug?(
          <ObservedTestBenchRunPanel key={selected.id} skillId={skillId}
            definition={selected} workspaceSlug={slug} readOnly={readOnly}/>
        ):null}
        {slug?<ObservedRunComparisonPanel skillId={skillId} workspaceSlug={slug}/>:null}
      </div>
    </section>
  );
}
