import { resolveIndexNowKey } from "@/lib/seo";
import { textResponse } from "@/lib/seo-response";

// IndexNow key verification file. Submissions pass
// keyLocation=<origin>/indexnow.txt (see scripts/seo/indexnow-submit.mjs).
export function GET() {
  const key = resolveIndexNowKey();

  if (!key) {
    return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  }

  return textResponse(key);
}
