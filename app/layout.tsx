import type { Metadata } from "next";
import localFont from "next/font/local";
import { SpeedInsights } from "@vercel/speed-insights/next";
import "./workspace.css";

const dmSans = localFont({
  src: "./fonts/dm-sans/DMSans-Variable.ttf",
  weight: "100 1000",
  style: "normal",
  display: "swap",
  variable: "--font-bizbox-sans",
  fallback: ["Avenir Next", "Avenir", "Segoe UI", "sans-serif"],
});

export const metadata: Metadata = {
  title: "BizBox",
  description: "Explore locations for your service business.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={dmSans.variable}>
      <body data-bizbox-theme="smoke">
        {children}
        {/* Vercel serves the script; on any other host it 404s into the console. */}
        {process.env.VERCEL ? <SpeedInsights /> : null}
      </body>
    </html>
  );
}
