import type { Metadata } from "next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import "./workspace.css";

export const metadata: Metadata = { title: "BizBox", description: "Explore locations for your service business." };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        {children}
        <SpeedInsights />
      </body>
    </html>
  );
}
