/* eslint-disable @next/next/no-img-element */
"use client";

import { useTweaks } from "@/components/savant/tweaks-context";

type SavantLogoProps = {
  className?: string;
};

export function SavantLogo({ className }: SavantLogoProps) {
  const { resolvedTheme } = useTweaks();
  const classes = className ? `savant-logo ${className}` : "savant-logo";
  const isDarkTheme = resolvedTheme === "dark";
  const src = isDarkTheme ? "/brand/savant-dark.png" : "/brand/savant-light.png";
  const width = isDarkTheme ? 1536 : 612;
  const height = isDarkTheme ? 1024 : 408;
  const toneClass = isDarkTheme
    ? "savant-logo-image-dark-surface"
    : "savant-logo-image-light-surface";

  return (
    <span className={classes} aria-hidden="true">
      <img
        className={`savant-logo-image ${toneClass}`}
        src={src}
        alt=""
        width={width}
        height={height}
        draggable={false}
        decoding="async"
      />
    </span>
  );
}