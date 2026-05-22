import { notFound } from "next/navigation";

import { SkillScreen } from "@/components/savant/screens/skill";
import { SKILLS } from "@/lib/savant-data";

export function generateStaticParams() {
  return SKILLS.map((s) => ({ id: s.id }));
}

export default async function SkillDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const exists = SKILLS.some((s) => s.id === id);
  if (!exists) notFound();
  return <SkillScreen skillId={id} />;
}
