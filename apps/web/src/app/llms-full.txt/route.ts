import { buildLlmsFullTxt, resolveSiteOrigin } from "@/lib/seo";
import { textResponse } from "@/lib/seo-response";

export function GET() {
  return textResponse(buildLlmsFullTxt(resolveSiteOrigin()), "text/markdown; charset=utf-8");
}
