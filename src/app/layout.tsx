import type { Metadata } from "next";
import { Manrope, Sora } from "next/font/google";
import "@/app/globals.css";

export const metadata: Metadata = {
  title: "Momentum OS",
  description: "A premium, capture-first productivity workspace for planning, execution, and review."
};

const bodyFont = Manrope({
  subsets: ["latin"],
  variable: "--font-body",
  weight: ["400", "500", "600", "700", "800"]
});

const displayFont = Sora({
  subsets: ["latin"],
  variable: "--font-display",
  weight: ["600", "700", "800"]
});

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${bodyFont.variable} ${displayFont.variable}`}>
      <body>{children}</body>
    </html>
  );
}
