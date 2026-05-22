import { auth0 } from "@/lib/auth0";
import { buildAuthViewer } from "@/lib/auth0-session";
import { OnboardingWizard } from "@/components/marketing/onboarding-wizard";

export const metadata = {
  title: "Set up your workspace",
};

type OnboardingSearchParams = {
  cycle?: string;
  seats?: string;
  cancelled?: string;
};

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<OnboardingSearchParams>;
}) {
  const params = await searchParams;
  const session = auth0 ? await auth0.getSession() : null;
  const viewer = buildAuthViewer(session?.user);

  const initialCycle = params.cycle === "monthly" ? "monthly" : "annual";
  const initialSeats = (() => {
    const n = Number(params.seats);
    return Number.isFinite(n) && n > 0 ? Math.min(500, Math.floor(n)) : 5;
  })();

  return (
    <OnboardingWizard
      viewer={viewer}
      initialCycle={initialCycle}
      initialSeats={initialSeats}
      wasCancelled={params.cancelled === "1"}
    />
  );
}
