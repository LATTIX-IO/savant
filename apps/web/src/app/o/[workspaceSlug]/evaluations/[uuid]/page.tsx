import { EvaluationDetailScreen } from "@/components/savant/screens/evaluation-detail";

export const metadata = { title: "Evaluation details" };

export default async function TenantEvaluationDetailPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string; uuid: string }>;
}) {
  const { uuid } = await params;

  return <EvaluationDetailScreen evaluationUuid={uuid} />;
}
