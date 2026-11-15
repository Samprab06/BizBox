import type { Metadata } from "next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import "./workspace.css";

export const metadata: Metadata = {
  title: "BizBox",
  description: "Explore locations for your service business.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body data-bizbox-theme="smoke">
        {children}
        {/* Vercel serves the script; on any other host it 404s into the console. */}
        {process.env.VERCEL ? <SpeedInsights /> : null}
      </body>
    </html>
  );
}
