import { SeoGuidePage } from "@/components/marketing/seo-guide-page";
import { buildPublicPageMetadata } from "@/lib/seo-metadata";

export const metadata = buildPublicPageMetadata("/ai-skill-evaluation");

export default function GuidePage() {
  return <SeoGuidePage guidePath="/ai-skill-evaluation" />;
}
