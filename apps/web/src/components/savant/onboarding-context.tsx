"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

type OnboardingContextValue = {
  open: boolean;
  show: () => void;
  hide: () => void;
  latestConnectedRepository: {
    id: string;
    at: number;
  } | null;
  reportRepositoryConnected: (id: string) => void;
};

const Ctx = createContext<OnboardingContextValue | null>(null);

export function OnboardingProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [latestConnectedRepository, setLatestConnectedRepository] = useState<{
    id: string;
    at: number;
  } | null>(null);
  const show = useCallback(() => setOpen(true), []);
  const hide = useCallback(() => setOpen(false), []);
  const reportRepositoryConnected = useCallback((id: string) => {
    setLatestConnectedRepository({ id, at: Date.now() });
  }, []);
  const value = useMemo(
    () => ({
      open,
      show,
      hide,
      latestConnectedRepository,
      reportRepositoryConnected,
    }),
    [hide, latestConnectedRepository, open, reportRepositoryConnected, show],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useOnboarding() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useOnboarding must be used inside <OnboardingProvider>");
  return ctx;
}
