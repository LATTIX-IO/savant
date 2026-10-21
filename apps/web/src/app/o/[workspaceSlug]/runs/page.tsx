import { RunsV2 } from "@/components/savant/screens/runs-v2";
import { RunsFallback } from "@/components/savant/screens/runs-fallback";
export const metadata={title:"Runs"};
export default function TenantRunsPage(){return <RunsFallback><RunsV2/></RunsFallback>;}
