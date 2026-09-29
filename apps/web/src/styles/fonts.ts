import { Newsreader } from "next/font/google";

// Display / editorial voice for marketing pages. Interface text stays on Geist
// (sans + mono) from the root layout.
export const displayFont = Newsreader({
  subsets: ["latin"],
  style: ["normal", "italic"],
  axes: ["opsz"],
  variable: "--font-display",
  display: "swap",
});
