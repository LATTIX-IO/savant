import { SeoGuidePage } from "@/components/marketing/seo-guide-page";
import { buildPublicPageMetadata } from "@/lib/seo-metadata";

export const metadata = buildPublicPageMetadata("/enterprise-ai-skill-governance");

export default function GuidePage() {
  return <SeoGuidePage guidePath="/enterprise-ai-skill-governance" />;
}
