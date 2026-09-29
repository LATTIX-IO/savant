/**
 * The Savant signal: the four-point star at the heart of the orbit mark, plus
 * the node primitive the orbit carries. Both are plain SVG so any diagram can
 * reuse them and inherit the theme through CSS variables.
 */

const K1 = 0.098;
const K2 = 0.426;

/** Path for the signal star centred on (cx, cy) with tip radius `r`. */
export function signalPath(cx: number, cy: number, r: number): string {
  const a = K1 * r;
  const b = K2 * r;
  const f = (n: number) => Number(n.toFixed(2));
  return [
    `M${f(cx)} ${f(cy - r)}`,
    `C${f(cx + a)} ${f(cy - b)} ${f(cx + b)} ${f(cy - a)} ${f(cx + r)} ${f(cy)}`,
    `C${f(cx + b)} ${f(cy + a)} ${f(cx + a)} ${f(cy + b)} ${f(cx)} ${f(cy + r)}`,
    `C${f(cx - a)} ${f(cy + b)} ${f(cx - b)} ${f(cy + a)} ${f(cx - r)} ${f(cy)}`,
    `C${f(cx - b)} ${f(cy - a)} ${f(cx - a)} ${f(cy - b)} ${f(cx)} ${f(cy - r)}Z`,
  ].join("");
}

export function SignalStar({
  cx,
  cy,
  r,
  className,
}: {
  cx: number;
  cy: number;
  r: number;
  className?: string;
}) {
  return <path className={className ? `signal-star ${className}` : "signal-star"} d={signalPath(cx, cy, r)} />;
}

export type SignalNodeState = "idle" | "on" | "signal" | "attention";

/**
 * A node on the orbit. State is exposed as `data-state` so CSS owns the look;
 * `signal` adds a halo ring so the active node never relies on colour alone.
 */
export function SignalNode({
  cx,
  cy,
  r = 7,
  state = "idle",
  className,
}: {
  cx: number;
  cy: number;
  r?: number;
  state?: SignalNodeState;
  className?: string;
}) {
  return (
    <g className={className ? `signal-node ${className}` : "signal-node"} data-state={state}>
      <circle className="signal-node-halo" cx={cx} cy={cy} r={r + 6} />
      <circle className="signal-node-core" cx={cx} cy={cy} r={r} />
    </g>
  );
}
