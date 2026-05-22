import type { ResolvedTheme, ThemePreference } from "./theme-preference";

export function buildBinaryThemeToggleState(resolvedTheme: ResolvedTheme): {
  isDark: boolean;
  nextTheme: ThemePreference;
  title: string;
} {
  const isDark = resolvedTheme === "dark";

  return {
    isDark,
    nextTheme: isDark ? "light" : "dark",
    title: isDark ? "Switch to light mode" : "Switch to dark mode",
  };
}