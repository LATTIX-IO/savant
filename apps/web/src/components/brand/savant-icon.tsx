import { OrbitSystem } from "./orbit-system";
import { SignalNode, SignalStar } from "./signal-node";

/**
 * The orbit mark drawn inline so it follows the theme and can carry motion.
 * For static contexts where an <img> is enough, use
 * /brand/savant-icon-light.svg and /brand/savant-icon-dark.svg directly.
 */
export function SavantIcon({
  size = 32,
  animated = false,
  title,
  className,
}: {
  size?: number;
  animated?: boolean;
  title?: string;
  className?: string;
}) {
  const classes = ["savant-icon", animated ? "is-animated" : "", className ?? ""].filter(Boolean).join(" ");

  return (
    <svg
      className={classes}
      width={size}
      height={size}
      viewBox="0 0 256 256"
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
    >
      <g className="savant-icon-orbit">
        <OrbitSystem cx={128} cy={128} r={72} />
      </g>
      <SignalStar cx={128} cy={128} r={61} />
      <SignalNode cx={128} cy={56} state="on" />
      <SignalNode cx={200} cy={128} state="on" />
      <SignalNode cx={56} cy={128} state="on" />
      <SignalNode cx={128} cy={200} state="idle" />
    </svg>
  );
}
