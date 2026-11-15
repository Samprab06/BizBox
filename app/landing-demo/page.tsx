import type { Metadata } from "next";
import localFont from "next/font/local";
import { LandingDemo } from "@/components/landing-demo/landing-demo";
import { DEMO } from "@/components/landing-demo/demo-data";
import macbook from "@/public/landing-assets/guided-demo/macbook-gpt-v3.json";

const geist = localFont({
  src: "../../public/fonts/geist-latin.woff2",
  display: "swap",
  // Shared landing CSS must not preload this legacy font on the DM Sans homepage.
  preload: false,
  weight: "100 900",
  variable: "--font-bizbox",
});

export const metadata: Metadata = {
  title: "BizBox — Test your business before you commit.",
  description: "A consultant and a sandbox for your next business decision.",
};

export default function LandingDemoPage() {
  return (
    <div className={geist.variable}>
      <LandingDemo demo={DEMO} macbook={macbook} />
    </div>
  );
}
