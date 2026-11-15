import type { Metadata } from "next";
import localFont from "next/font/local";
import { LandingStory } from "@/components/landing-story/landing-story";
import { createLocationStory } from "@/components/landing-story/location-data";
import { DEMO } from "@/components/landing-demo/demo-data";
import macbook from "@/public/landing-assets/guided-demo/macbook-gpt-v3.json";
const geist = localFont({
  src: "../../public/fonts/geist-latin.woff2",
  display: "swap",
  weight: "100 900",
  variable: "--font-bizbox",
});
export const metadata: Metadata = {
  title: "BizBox — Test your business before you commit.",
  description:
    "Compare locations and test a business decision with a consultant and a sandbox.",
  robots: { index: false, follow: false },
};
export default function LandingStoryPage() {
  return (
    <div className={geist.variable}>
      <LandingStory
        data={createLocationStory()}
        demo={{
          ...DEMO,
          business: {
            ...DEMO.business,
            name: "Neighborhood coffee + breakfast",
            concept:
              "Specialty coffee and breakfast for commuters and nearby residents. Takeaway service, with space to sit.",
            buildout: 9000,
            area: "Montrose or The Heights",
          },
        }}
        macbook={macbook}
      />
    </div>
  );
}
