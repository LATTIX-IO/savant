/** Plain-text response for crawler-facing files, cacheable at the CDN edge. */
export function textResponse(body: string, contentType = "text/plain; charset=utf-8"): Response {
  return new Response(body, {
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800",
    },
  });
}
