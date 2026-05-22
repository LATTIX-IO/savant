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

import {
  isThemePreference,
  resolveThemePreference,
  SAVANT_UI_TWEAKS_STORAGE_KEY,
  type ResolvedTheme,
  type ThemePreference,
} from "@/lib/theme-preference";

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
  theme: ThemePreference;
};

const DEFAULTS: Tweaks = {
  accent: "moss",
  density: "regular",
  theme: "system",
};

type TweaksContextValue = {
  values: Tweaks;
  resolvedTheme: ResolvedTheme;
  set: <K extends keyof Tweaks>(key: K, value: Tweaks[K]) => void;
};

const TweaksContext = createContext<TweaksContextValue | null>(null);

function isAccentKey(value: unknown): value is AccentKey {
  return typeof value === "string" && value in ACCENT_PALETTES;
}

function isDensityKey(value: unknown): value is DensityKey {
  return value === "compact" || value === "regular" || value === "roomy";
}

function getSystemPrefersDark(): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function readStoredTweaks(): Tweaks {
  if (typeof window === "undefined") {
    return DEFAULTS;
  }

  try {
    const raw = window.localStorage.getItem(SAVANT_UI_TWEAKS_STORAGE_KEY);
    if (!raw) {
      return DEFAULTS;
    }

    const parsed = JSON.parse(raw) as Partial<Record<keyof Tweaks, unknown>>;

    return {
      accent: isAccentKey(parsed.accent) ? parsed.accent : DEFAULTS.accent,
      density: isDensityKey(parsed.density) ? parsed.density : DEFAULTS.density,
      theme: isThemePreference(parsed.theme) ? parsed.theme : DEFAULTS.theme,
    };
  } catch {
    return DEFAULTS;
  }
}

function applyTweaks(t: Tweaks, resolvedTheme: ResolvedTheme): ResolvedTheme {
  if (typeof document === "undefined") {
    return resolvedTheme;
  }

  const root = document.documentElement;
  const p = ACCENT_PALETTES[t.accent] || ACCENT_PALETTES.moss;
  root.style.setProperty("--accent", p.accent);
  root.style.setProperty("--accent-soft", p.soft);
  root.style.setProperty("--accent-deep", p.deep);
  root.setAttribute("data-theme", resolvedTheme);
  root.style.colorScheme = resolvedTheme;
  const body = document.body;
  body.classList.remove("density-compact", "density-regular", "density-roomy");
  body.classList.add(`density-${t.density}`);
  body.classList.remove("serif-off");

  return resolvedTheme;
}

export function TweaksProvider({ children }: { children: ReactNode }) {
  const [values, setValues] = useState<Tweaks>(() => readStoredTweaks());
  const [systemPrefersDark, setSystemPrefersDark] = useState<boolean>(() => getSystemPrefersDark());

  const resolvedTheme = useMemo<ResolvedTheme>(
    () => resolveThemePreference(values.theme, systemPrefersDark),
    [systemPrefersDark, values.theme],
  );

  useEffect(() => {
    applyTweaks(values, resolvedTheme);

    try {
      window.localStorage.setItem(SAVANT_UI_TWEAKS_STORAGE_KEY, JSON.stringify(values));
    } catch {
      // Ignore storage failures and keep the session usable.
    }
  }, [resolvedTheme, values]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return undefined;
    }

    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const syncSystemTheme = () => setSystemPrefersDark(mediaQuery.matches);

    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", syncSystemTheme);
    } else {
      mediaQuery.addListener(syncSystemTheme);
    }

    return () => {
      if (typeof mediaQuery.removeEventListener === "function") {
        mediaQuery.removeEventListener("change", syncSystemTheme);
      } else {
        mediaQuery.removeListener(syncSystemTheme);
      }
    };
  }, []);

  const set = useCallback(<K extends keyof Tweaks>(key: K, value: Tweaks[K]) => {
    setValues((prev) => ({ ...prev, [key]: value }));
  }, []);

  const ctx = useMemo<TweaksContextValue>(
    () => ({ values, resolvedTheme, set }),
    [resolvedTheme, set, values],
  );
  return <TweaksContext.Provider value={ctx}>{children}</TweaksContext.Provider>;
}

export function useTweaks() {
  const ctx = useContext(TweaksContext);
  if (!ctx) throw new Error("useTweaks must be used inside <TweaksProvider>");
  return ctx;
}
