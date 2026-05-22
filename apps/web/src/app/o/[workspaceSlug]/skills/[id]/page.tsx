import { notFound } from "next/navigation";

import { SkillScreen } from "@/components/savant/screens/skill";
import { SKILLS } from "@/lib/savant-data";

export default async function TenantSkillDetailPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string; id: string }>;
}) {
  const { id } = await params;
  const exists = SKILLS.some((skill) => skill.id === id);

  if (!exists) {
    notFound();
  }

  return <SkillScreen skillId={id} />;
}