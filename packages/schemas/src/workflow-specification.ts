import type { WorkflowSpecification, WorkflowNode, WorkflowPort, WorkflowEdge } from "@savant/types/workflow-specification";

export class WorkflowSpecError extends Error {
  constructor(public readonly code: string, public readonly path: string) {
    super(`${code}: ${path}`);
    this.name = "WorkflowSpecError";
  }
}

const KINDS = ["agent", "skill", "tool", "model", "decision", "subworkflow", "opaque"] as const;
const ID = "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$";
const portSchema = { type: "object", required: ["id", "dataType"], additionalProperties: false, properties: {
  id: { type: "string", pattern: ID }, dataType: { type: "string", minLength: 1, maxLength: 128 }, required: { type: "boolean" },
}} as const;
const refSchema = { type: "object", required: ["nodeId", "portId"], additionalProperties: false, properties: {
  nodeId: { type: "string", pattern: ID }, portId: { type: "string", pattern: ID },
}} as const;
export const workflowSpecificationSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://savant.dev/schemas/workflow-specification/v1.json",
  title: "WorkflowSpecificationV1",
  type: "object", additionalProperties: false,
  required: ["schemaVersion", "workflowId", "version", "source", "nodes", "edges"],
  properties: {
    schemaVersion: { const: 1 },
    workflowId: { type: "string", pattern: ID },
    version: { type: "string", minLength: 1, maxLength: 80 },
    source: { type: "object", additionalProperties: false, required: ["runtime"], properties: {
      runtime: { type: "string", minLength: 1, maxLength: 128 }, sourceRef: { type: "string", maxLength: 512 },
      sourceVersion: { type: "string", maxLength: 128 },
    } },
    nodes: { type: "array", maxItems: 1000, items: { type: "object", additionalProperties: false,
      required: ["id", "kind"], properties: {
        id: { type: "string", pattern: ID }, kind: { enum: KINDS },
        label: { type: "string", maxLength: 2048 },
        inputs: { type: "array", maxItems: 100, items: portSchema },
        outputs: { type: "array", maxItems: 100, items: portSchema },
        native: { type: "object" }, extensions: { type: "object" },
      },
    } },
    edges: { type: "array", maxItems: 5000, items: { type: "object", additionalProperties: false,
      required: ["id", "from", "to"], properties: {
        id: { type: "string", pattern: ID }, from: refSchema, to: refSchema,
        condition: { type: "object", additionalProperties: false, required: ["format", "expression"], properties: {
          format: { const: "opaque" }, expression: { type: "string", maxLength: 4096 },
          extensions: { type: "object" },
        } },
      },
    } },
    outcomeRefs: { type: "array", maxItems: 1000, items: { type: "string", maxLength: 512 } },
    extensions: { type: "object" },
  },
} as const;

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
function fail(code: string, path: string): never { throw new WorkflowSpecError(code, path); }
function object(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail("invalid-object", path);
  return value as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, allowed: readonly string[], path: string): void {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) fail("invalid-field", path + "." + key);
}
function string(value: unknown, path: string, max = 128, pattern = false): string {
  if (typeof value !== "string" || !value || value.length > max || (pattern && !ID_RE.test(value))) fail("invalid-string", path);
  return value as string;
}
function safeUnknown(value: unknown, path: string, depth = 0): void {
  if (depth > 20) fail("depth-limit", path);
  if (Array.isArray(value)) {
    if (value.length > 5000) fail("size-limit", path);
    value.forEach((item, i) => safeUnknown(item, `${path}[${i}]`, depth + 1));
  } else if (value !== null && typeof value === "object") {
    const raw = value as Record<string, unknown>;
    if (Object.keys(raw).length > 1000) fail("size-limit", path);
    for (const [k, v] of Object.entries(raw)) {
      if (["__proto__", "prototype", "constructor"].includes(k)) fail("unsafe-key", path + "." + k);
      safeUnknown(v, path + "." + k, depth + 1);
    }
  } else if (!(value === null || typeof value === "string" || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value)))) {
    fail("invalid-value", path);
  }
}
function ports(raw: unknown, path: string): WorkflowPort[] | undefined {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw) || raw.length > 100) fail("invalid-port", path);
  const used = new Set<string>();
  for (const [i, item] of (raw as unknown[]).entries()) {
    const p = object(item, path + "[" + i + "]");
    keys(p, ["id", "dataType", "required"], path);
    if (typeof p.id !== "string" || !ID_RE.test(p.id) || typeof p.dataType !== "string" || !p.dataType || p.dataType.length > 128 || (p.required !== undefined && typeof p.required !== "boolean")) fail("invalid-port", path);
    if (used.has(p.id)) fail("duplicate-port", path);
    used.add(p.id);
  }
  return raw as WorkflowPort[];
}
function reference(raw: unknown, path: string): { nodeId: string; portId: string } {
  const ref = object(raw, path);
  keys(ref, ["nodeId", "portId"], path);
  string(ref.nodeId, path + ".nodeId", 128, true);
  string(ref.portId, path + ".portId", 128, true);
  return ref as { nodeId: string; portId: string };
}
/** Pure bounded parser. It never executes native extensions or expressions. */
export function parseWorkflowSpecification(input: unknown): WorkflowSpecification {
  safeUnknown(input, "$");
  const wire = JSON.stringify(input);
  if (!wire || wire.length > 512_000) fail("size-limit", "$");
  const root = object(input, "$");
  if (root.schemaVersion !== 1) fail("unsupported-version", "$.schemaVersion");
  keys(root, ["schemaVersion", "workflowId", "version", "source", "nodes", "edges", "outcomeRefs", "extensions"], "$");
  string(root.workflowId, "$.workflowId", 128, true);
  string(root.version, "$.version", 80);
  const source = object(root.source, "$.source");
  keys(source, ["runtime", "sourceRef", "sourceVersion"], "$.source");
  string(source.runtime, "$.source.runtime");
  if (source.sourceRef !== undefined) string(source.sourceRef, "$.source.sourceRef", 512);
  if (source.sourceVersion !== undefined) string(source.sourceVersion, "$.source.sourceVersion", 128);
  if (!Array.isArray(root.nodes) || root.nodes.length > 1000) fail("invalid-nodes", "$.nodes");
  if (!Array.isArray(root.edges) || root.edges.length > 5000) fail("invalid-edges", "$.edges");
  const nodeMap = new Map<string, WorkflowNode>();
  for (const [i, entry] of (root.nodes as unknown[]).entries()) {
    const path = `$.nodes[${i}]`;
    const node = object(entry, path);
    keys(node, ["id", "kind", "label", "inputs", "outputs", "native", "extensions"], path);
    string(node.id, path + ".id", 128, true);
    if (!KINDS.includes(node.kind as (typeof KINDS)[number])) fail("invalid-node", path);
    if (nodeMap.has(node.id as string)) fail("duplicate-node", path);
    if (node.label !== undefined && (typeof node.label !== "string" || node.label.length > 2048)) fail("invalid-node", path);
    ports(node.inputs, path + ".inputs"); ports(node.outputs, path + ".outputs");
    if (node.native !== undefined) {
      const native = object(node.native, path + ".native");
      string(native.kind, path + ".native.kind");
    }
    if (node.kind === "opaque" && node.native === undefined) fail("invalid-node", path);
    if (node.extensions !== undefined) object(node.extensions, path + ".extensions");
    nodeMap.set(node.id as string, node as unknown as WorkflowNode);
  }
  const edgeIds = new Set<string>();
  const successors = new Map([...nodeMap.keys()].map(id => [id, [] as string[]]));
  const indegree = new Map([...nodeMap.keys()].map(id => [id, 0]));
  for (const [i, entry] of (root.edges as unknown[]).entries()) {
    const path = `$.edges[${i}]`;
    const edge = object(entry, path);
    keys(edge, ["id", "from", "to", "condition"], path);
    string(edge.id, path + ".id", 128, true);
    if (edgeIds.has(edge.id as string)) fail("duplicate-edge", path);
    edgeIds.add(edge.id as string);
    const from = reference(edge.from, path + ".from");
    const to = reference(edge.to, path + ".to");
    for (const [ref, direction] of [[from, "outputs"], [to, "inputs"]] as const) {
      const node = nodeMap.get(ref.nodeId);
      if (!node) fail("missing-node", path);
      if (!node[direction]?.some(port => port.id === ref.portId)) fail("missing-port", path);
    }
    if (edge.condition !== undefined) {
      const cond = object(edge.condition, path + ".condition");
      keys(cond, ["format", "expression", "extensions"], path + ".condition");
      if (cond.format !== "opaque") fail("invalid-condition", path);
      string(cond.expression, path + ".condition.expression", 4096);
      if (cond.extensions !== undefined) object(cond.extensions, path + ".condition.extensions");
    }
    successors.get(from.nodeId)!.push(to.nodeId);
    indegree.set(to.nodeId, indegree.get(to.nodeId)! + 1);
  }
  let frontier = [...indegree].filter(([, d]) => d === 0).map(([id]) => id);
  let visited = 0;
  while (frontier.length) {
    const next: string[] = [];
    for (const id of frontier) {
      visited++;
      for (const target of successors.get(id)!) {
        const degree = indegree.get(target)! - 1;
        indegree.set(target, degree);
        if (!degree) next.push(target);
      }
    }
    frontier = next;
  }
  if (visited !== nodeMap.size) fail("cycle", "$.edges");
  if (root.outcomeRefs !== undefined) {
    if (!Array.isArray(root.outcomeRefs) || root.outcomeRefs.length > 1000) fail("invalid-outcomes", "$.outcomeRefs");
    for (const value of root.outcomeRefs) string(value, "$.outcomeRefs[]", 512);
  }
  if (root.extensions !== undefined) object(root.extensions, "$.extensions");
  return root as unknown as WorkflowSpecification;
}
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, val]) => [key, canonical(val)]));
  }
  return value;
}
/** Deterministic byte representation for external SHA-256/version provenance. */
export function canonicalizeWorkflowSpecification(spec: WorkflowSpecification): string {
  return JSON.stringify(canonical(parseWorkflowSpecification(spec)));
}
