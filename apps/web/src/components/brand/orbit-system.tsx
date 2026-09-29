/**
 * Orbit geometry from the Savant mark: a ring (ecosystem), two tilted
 * ellipses (motion), and the governance axes. Diagrams compose it instead of
 * redrawing the mark so the motif stays consistent wherever it appears.
 */
export function OrbitSystem({
  cx,
  cy,
  r,
  axes = true,
  ellipses = true,
  className,
}: {
  cx: number;
  cy: number;
  r: number;
  axes?: boolean;
  ellipses?: boolean;
  className?: string;
}) {
  const minor = r * 0.56;
  const reach = r * 1.18;

  return (
    <g className={className ? `orbit-system ${className}` : "orbit-system"} fill="none">
      <circle className="orbit-ring" cx={cx} cy={cy} r={r} />
      {ellipses ? (
        <g className="orbit-ellipses">
          <ellipse cx={cx} cy={cy} rx={r} ry={minor} transform={`rotate(45 ${cx} ${cy})`} />
          <ellipse cx={cx} cy={cy} rx={r} ry={minor} transform={`rotate(-45 ${cx} ${cy})`} />
        </g>
      ) : null}
      {axes ? (
        <path
          className="orbit-axes"
          d={`M${cx} ${cy - reach}V${cy + reach}M${cx - reach} ${cy}H${cx + reach}`}
        />
      ) : null}
    </g>
  );
}

/** Point on a circle, with 0° at three o'clock and angles growing clockwise. */
export function orbitPoint(cx: number, cy: number, r: number, degrees: number) {
  const rad = (degrees * Math.PI) / 180;
  return {
    x: Number((cx + r * Math.cos(rad)).toFixed(2)),
    y: Number((cy + r * Math.sin(rad)).toFixed(2)),
  };
}
