import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Script from "next/script";
import "./globals.css";

import { SAVANT_UI_TWEAKS_STORAGE_KEY } from "@/lib/theme-preference";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "Savant — Skills, governed",
    template: "%s | Savant",
  },
  description:
    "Savant is the enterprise platform for codifying expertise as governed, measurable, reusable skills.",
};

const themeBootstrapScript = `
(() => {
  const root = document.documentElement;
  const systemTheme = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  let themePreference = "system";

  try {
    const raw = window.localStorage.getItem("${SAVANT_UI_TWEAKS_STORAGE_KEY}");
    if (raw) {
      const parsed = JSON.parse(raw);
      const candidate = parsed?.theme;
      if (candidate === "light" || candidate === "dark" || candidate === "system") {
        themePreference = candidate;
      }
    }
  } catch {
    // Ignore malformed saved state and fall back to system.
  }

  const resolvedTheme = themePreference === "system" ? systemTheme : themePreference;
  root.setAttribute("data-theme", resolvedTheme);
  root.style.colorScheme = resolvedTheme;
})();
`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      data-theme="light"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable}`}
    >
      <head>
        <Script id="savant-theme-init" strategy="beforeInteractive">
          {themeBootstrapScript}
        </Script>
      </head>
      <body className="density-regular">{children}</body>
    </html>
  );
}
