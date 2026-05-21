"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type AccentKey = "moss" | "brass" | "oxblood" | "slate" | "ink";
export type DensityKey = "compact" | "regular" | "roomy";

export const ACCENT_PALETTES: Record<AccentKey, { accent: string; soft: string; deep: string }> = {
  moss: { accent: "#5C6B4F", soft: "#E8EBE0", deep: "#3F4A36" },
  brass: { accent: "#B8860B", soft: "#F5E9C8", deep: "#8A6309" },
  oxblood: { accent: "#8B3A2F", soft: "#F2DAD2", deep: "#6B2A22" },
  slate: { accent: "#4A5568", soft: "#E2E5EA", deep: "#2D3748" },
  ink: { accent: "#1C1B18", soft: "#E5DFD3", deep: "#000000" },
};

export type Tweaks = {
  accent: AccentKey;
  density: DensityKey;
};

const DEFAULTS: Tweaks = {
  accent: "moss",
  density: "regular",
};

type TweaksContextValue = {
  values: Tweaks;
  set: <K extends keyof Tweaks>(key: K, value: Tweaks[K]) => void;
};

const TweaksContext = createContext<TweaksContextValue | null>(null);

function applyTweaks(t: Tweaks) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const p = ACCENT_PALETTES[t.accent] || ACCENT_PALETTES.moss;
  root.style.setProperty("--accent", p.accent);
  root.style.setProperty("--accent-soft", p.soft);
  root.style.setProperty("--accent-deep", p.deep);
  const body = document.body;
  body.classList.remove("density-compact", "density-regular", "density-roomy");
  body.classList.add(`density-${t.density}`);
  body.classList.remove("serif-off");
}

export function TweaksProvider({ children }: { children: ReactNode }) {
  const [values, setValues] = useState<Tweaks>(DEFAULTS);

  useEffect(() => {
    applyTweaks(values);
  }, [values]);

  const set = useCallback(<K extends keyof Tweaks>(key: K, value: Tweaks[K]) => {
    setValues((prev) => ({ ...prev, [key]: value }));
  }, []);

  const ctx = useMemo<TweaksContextValue>(() => ({ values, set }), [values, set]);
  return <TweaksContext.Provider value={ctx}>{children}</TweaksContext.Provider>;
}

export function useTweaks() {
  const ctx = useContext(TweaksContext);
  if (!ctx) throw new Error("useTweaks must be used inside <TweaksProvider>");
  return ctx;
}
