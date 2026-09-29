/* eslint-disable @next/next/no-img-element */

type Variant = "wordmark" | "lockup";

const ASSETS: Record<Variant, { light: string; dark: string; width: number; height: number }> = {
  // Mark + SAVANT, cropped tight for navigation.
  wordmark: {
    light: "/brand/savant-wordmark-light.svg",
    dark: "/brand/savant-wordmark-dark.svg",
    width: 728,
    height: 204,
  },
  // Full lockup with descriptor line.
  lockup: {
    light: "/brand/savant-logo-light.svg",
    dark: "/brand/savant-logo-dark.svg",
    width: 1200,
    height: 280,
  },
};

/**
 * Both tone variants stay mounted and CSS shows the right one for the surface:
 * the light asset on light surfaces, the dark asset inside dark mode or a
 * `.savant-dark` section. Picking in React would flash before hydration.
 */
export function SavantLogo({
  variant = "wordmark",
  className,
  label = "Savant",
}: {
  variant?: Variant;
  className?: string;
  label?: string;
}) {
  const asset = ASSETS[variant];

  return (
    <span className={className ? `brand-logo ${className}` : "brand-logo"} role="img" aria-label={label}>
      <img
        className="brand-asset-light"
        src={asset.light}
        alt=""
        width={asset.width}
        height={asset.height}
        draggable={false}
        decoding="async"
      />
      <img
        className="brand-asset-dark"
        src={asset.dark}
        alt=""
        width={asset.width}
        height={asset.height}
        draggable={false}
        decoding="async"
      />
    </span>
  );
}
