import {TestBenchError} from "./definition-contract.ts";
const MAX_REQUEST_BYTES=20*1024;
/** Bound reads before JSON.parse, including chunked uploads with no Content-Length. */
export async function readBoundedTestBenchBody(request:Request):Promise<unknown>{
  if(!/^application\/json(?:\s*;|\s*$)/i.test(request.headers.get("content-type")??""))
    throw new TestBenchError("test_bench_json_required",415);
  const declared=request.headers.get("content-length");
  if(declared!==null&&(!/^\d+$/.test(declared)||Number(declared)>MAX_REQUEST_BYTES))
    throw new TestBenchError("test_bench_request_too_large",413);
  if(!request.body)throw new TestBenchError("test_bench_json_required",400);
  const reader=request.body.getReader();
  const chunks:Uint8Array[]=[];
  let size=0;
  try{
    while(true){
      const {done,value}=await reader.read();
      if(done)break;
      size+=value.byteLength;
      if(size>MAX_REQUEST_BYTES)throw new TestBenchError("test_bench_request_too_large",413);
      chunks.push(value);
    }
  }catch(error){
    await reader.cancel().catch(()=>{});
    if(error instanceof TestBenchError)throw error;
    throw new TestBenchError("test_bench_body_unavailable",400);
  }finally{reader.releaseLock();}
  try{
    const buffer=Buffer.concat(chunks.map(chunk=>Buffer.from(chunk)));
    return JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(buffer)) as unknown;
  }catch{throw new TestBenchError("test_bench_json_invalid",400);}
}
