import type { Metadata } from "next";

import { PRODUCT_NAME, PRODUCT_SUMMARY, PRODUCT_TAGLINE } from "./marketing-content.ts";
import { isIndexableDeployment, PUBLIC_ROUTES, resolveSiteOrigin, type PublicRoute } from "./seo.ts";

// Next.js replaces (does not merge) openGraph/twitter objects per segment, so
// every level that sets them has to carry the shared fields and image.
const OPEN_GRAPH_BASE = {
  type: "website",
  siteName: PRODUCT_NAME,
  locale: "en_US",
  images: [{ url: "/opengraph-image", width: 1200, height: 630, alt: `${PRODUCT_NAME} — ${PRODUCT_TAGLINE}` }],
} satisfies NonNullable<Metadata["openGraph"]>;

const TWITTER_BASE = {
  card: "summary_large_image",
  images: ["/opengraph-image"],
} satisfies NonNullable<Metadata["twitter"]>;

/** Site-wide defaults for the root layout. Pages override title/description/canonical. */
export function buildRootMetadata(env = process.env): Metadata {
  const indexable = isIndexableDeployment(env);
  const other: Record<string, string> = {};

  if (env.BING_SITE_VERIFICATION) other["msvalidate.01"] = env.BING_SITE_VERIFICATION;

  return {
    metadataBase: new URL(resolveSiteOrigin(env)),
    applicationName: PRODUCT_NAME,
    category: "technology",
    creator: "Lattix Technologies Corp.",
    publisher: "Lattix Technologies Corp.",
    keywords: [
      "AI skill governance",
      "agent skills",
      "prompt management",
      "LLM evaluation",
      "AI governance platform",
      "skills as code",
      "Git-backed prompts",
    ],
    robots: indexable
      ? { index: true, follow: true, googleBot: { index: true, follow: true, "max-snippet": -1, "max-image-preview": "large" } }
      : { index: false, follow: false },
    openGraph: { ...OPEN_GRAPH_BASE, description: PRODUCT_SUMMARY },
    twitter: TWITTER_BASE,
    verification: {
      google: env.GOOGLE_SITE_VERIFICATION || undefined,
      other,
    },
    alternates: {
      types: {
        "text/markdown": "/llms.txt",
      },
    },
  };
}

/** Title, description, canonical, and social cards for one public route. */
export function buildPublicPageMetadata(path: PublicRoute["path"], overrides: Metadata = {}): Metadata {
  const route = PUBLIC_ROUTES.find((candidate) => candidate.path === path);

  if (!route) {
    throw new Error(`No public route registered for ${path}.`);
  }

  const socialTitle = path === "/" ? route.title : `${route.title} | ${PRODUCT_NAME}`;

  return {
    title: path === "/" ? { absolute: route.title } : route.title,
    description: route.description,
    alternates: { canonical: path, types: { "text/markdown": "/llms.txt" } },
    openGraph: { ...OPEN_GRAPH_BASE, title: socialTitle, description: route.description, url: path },
    twitter: { ...TWITTER_BASE, title: socialTitle, description: route.description },
    ...overrides,
  };
}

export const NOINDEX_METADATA: Metadata = {
  robots: { index: false, follow: false },
};
