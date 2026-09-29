import { buildRobotsTxt, isIndexableDeployment, resolveSiteOrigin } from "@/lib/seo";
import { textResponse } from "@/lib/seo-response";

// Hand-written instead of app/robots.ts so it can carry Content-Signal
// directives, which MetadataRoute.Robots cannot express.
export function GET() {
  return textResponse(buildRobotsTxt({ origin: resolveSiteOrigin(), indexable: isIndexableDeployment() }));
}
