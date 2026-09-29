/* eslint-disable @next/next/no-img-element */

type SavantLogoProps = {
  className?: string;
};

/**
 * Both tone variants are rendered and CSS picks one from `html[data-theme]`,
 * which the theme bootstrap script sets before first paint. Choosing in React
 * instead would flash the wrong logo until hydration resolved the theme.
 *
 *   savant-wordmark-light.svg → light surfaces (dark ink)
 *   savant-wordmark-dark.svg  → dark surfaces (light ink)
 */
export function SavantLogo({ className }: SavantLogoProps) {
  const classes = className ? `savant-logo ${className}` : "savant-logo";

  return (
    <span className={classes} aria-hidden="true">
      <img
        className="savant-logo-image savant-logo-for-light"
        src="/brand/savant-wordmark-light.svg"
        alt=""
        width={728}
        height={204}
        draggable={false}
        decoding="async"
      />
      <img
        className="savant-logo-image savant-logo-for-dark"
        src="/brand/savant-wordmark-dark.svg"
        alt=""
        width={728}
        height={204}
        draggable={false}
        decoding="async"
      />
    </span>
  );
}
