import { buildLlmsTxt, resolveSiteOrigin } from "@/lib/seo";
import { textResponse } from "@/lib/seo-response";

export function GET() {
  return textResponse(buildLlmsTxt(resolveSiteOrigin()), "text/markdown; charset=utf-8");
}
