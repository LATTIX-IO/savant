import { SeoGuidePage } from "@/components/marketing/seo-guide-page";
import { buildPublicPageMetadata } from "@/lib/seo-metadata";

export const metadata = buildPublicPageMetadata("/ai-agent-skill-management");

export default function GuidePage() {
  return <SeoGuidePage guidePath="/ai-agent-skill-management" />;
}
