import { SkillScreen } from "@/components/savant/screens/skill";

export default async function TenantSkillDetailPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string; id: string }>;
}) {
  const { id } = await params;

  return <SkillScreen skillId={id} />;
}