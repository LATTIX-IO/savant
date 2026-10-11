/** Portable, non-executable QA description of a customer-owned workflow. */
export type WorkflowNodeKind = "agent" | "skill" | "tool" | "model" | "decision" | "subworkflow" | "opaque";
export interface WorkflowPort { id: string; dataType: string; required?: boolean; }
export interface WorkflowNode {
  id: string;
  kind: WorkflowNodeKind;
  label?: string;
  inputs?: WorkflowPort[];
  outputs?: WorkflowPort[];
  /** Required for opaque native nodes; retained without interpreting it. */
  native?: { kind: string; payload?: Record<string, unknown> };
  extensions?: Record<string, unknown>;
}
export interface WorkflowEdge {
  id: string;
  from: { nodeId: string; portId: string };
  to: { nodeId: string; portId: string };
  condition?: { format: "opaque"; expression: string; extensions?: Record<string, unknown> };
}
export interface WorkflowSpecification {
  schemaVersion: 1;
  workflowId: string;
  version: string;
  source: { runtime: string; sourceRef?: string; sourceVersion?: string };
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  outcomeRefs?: string[];
  extensions?: Record<string, unknown>;
}
