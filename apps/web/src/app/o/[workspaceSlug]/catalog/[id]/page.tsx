import { SkillHubSkillScreen } from "@/components/savant/screens/skill-hub";

export const metadata = { title: "Catalog skill" };

export default async function TenantCatalogSkillPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <SkillHubSkillScreen id={id} />;
}
