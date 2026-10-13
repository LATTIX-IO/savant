"use client";

import { createContext, useContext, type ReactNode } from "react";

type UiV2Context = Readonly<{ enabled: boolean; workspaceSlug: string | null }>;
const Mode = createContext<UiV2Context>({ enabled: false, workspaceSlug: null });

// Presentation mode only. Server membership and API authorization remain authoritative.
export function UiV2ModeProvider({ children, workspaceSlug }: {
  children: ReactNode; workspaceSlug: string;
}) {
  return <Mode.Provider value={{ enabled: true, workspaceSlug }}>{children}</Mode.Provider>;
}
export function useUiV2Mode(): boolean {
  return useContext(Mode).enabled;
}
export function useUiV2WorkspaceSlug(): string | null {
  return useContext(Mode).workspaceSlug;
}
