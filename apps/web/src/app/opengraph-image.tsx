import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { ImageResponse } from "next/og";

import { PRODUCT_TAGLINE } from "@/lib/marketing-content";

export const alt = `Savant — ${PRODUCT_TAGLINE}`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// Default social card for every route that does not define its own.
export default async function OpenGraphImage() {
  const icon = await readFile(join(process.cwd(), "public/brand/savant-icon-dark.svg"), "utf8");
  const iconSrc = `data:image/svg+xml;base64,${Buffer.from(icon).toString("base64")}`;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "72px 80px",
          background: "#202427",
          color: "#FDFCFE",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
          {/* eslint-disable-next-line @next/next/no-img-element -- rendered by Satori, not the browser */}
          <img src={iconSrc} width={88} height={88} alt="" />
          <span style={{ fontSize: 56, fontWeight: 600, letterSpacing: -1 }}>Savant</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <span style={{ fontSize: 30, color: "#F2CD35", textTransform: "uppercase", letterSpacing: 2 }}>
            {PRODUCT_TAGLINE}
          </span>
          <span style={{ fontSize: 76, fontWeight: 600, lineHeight: 1.05, letterSpacing: -2 }}>
            Turn expertise into governed capability.
          </span>
        </div>
        <div style={{ display: "flex", gap: 36, fontSize: 28, color: "#D0D7DC" }}>
          <span>Git-backed</span>
          <span>Eval-driven</span>
          <span>SSO-controlled</span>
          <span>Audit-ready</span>
        </div>
      </div>
    ),
    size,
  );
}
