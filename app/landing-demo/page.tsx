import type { Metadata } from "next";
import { LandingDemo } from "@/components/landing-demo/landing-demo";
import { DEMO } from "@/components/landing-demo/demo-data";
import macbook from "@/public/landing-assets/guided-demo/macbook-frame-v2.json";

export const metadata: Metadata = {
  title: "BizBox — Test your business before you commit.",
  description:
    "Explore a location, step inside and test a business decision with BizBox.",
};

export default function LandingDemoPage() {
  return <LandingDemo demo={DEMO} macbook={macbook} />;
}
