"use client";

import { useUiV2Mode } from "@/components/savant/ui-v2/mode";
import { WorkflowStudioV2 } from "./workflow-studio-v2";

/** Existing classic shell remains the rollback path; no silent v2 activation. */
export function WorkflowStudioEntry() {
  const enabled = useUiV2Mode();
  return enabled
    ? <WorkflowStudioV2 />
    : <main style={{padding:24}}><h1>Workflow Studio</h1>
        <p>Workflow modeling requires the Savant v2 workspace. No workflow was loaded or changed.</p>
      </main>;
}
