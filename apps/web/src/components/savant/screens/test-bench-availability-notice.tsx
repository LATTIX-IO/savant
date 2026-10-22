"use client";

import Link from "next/link";
import type {Route} from "next";
import {buildTenantAwareAppPath} from "@/lib/tenant-paths";
import {classifyTestBenchAvailability} from "@/lib/ui-v2-test-bench-availability";
import styles from "./test-bench-availability.module.css";

/** Alert surfaces are read-only. They never issue DDL, provision secrets,
 * reconstruct case data, or claim a historic indexed score is a provider run. */
export function TestBenchAvailabilityNotice({error,pathname,onRetry}:{
 error:unknown;pathname:string;onRetry?:()=>void;
}){
 const state=classifyTestBenchAvailability(error);
 return <section className={styles.notice} role="alert"
   aria-label="Saved Test Bench readiness">
   <div className={styles.body}>
     <strong>{state.heading}</strong>
     <p>{state.explanation}</p>
     <p>Historical Git-indexed evaluation results remain separate. A completed
       indexed benchmark is not proof that these encrypted suites or live provider runs are available.</p>
   </div>
   <div className={styles.actions}>
     <Link className={styles.link}
       href={buildTenantAwareAppPath(pathname,"/settings?section=setup") as Route}>
       Open Settings → Setup
     </Link>
     {onRetry?<button type="button" className={styles.retry} onClick={onRetry}>
       Retry saved cases</button>:null}
   </div>
 </section>;
}
