import type { Metadata } from "next";
import { preload } from "react-dom";
import { LandingStory } from "@/components/landing-story/landing-story";
import { createLocationStory } from "@/components/landing-story/location-data";
import { DEMO } from "@/components/landing-demo/demo-data";
import macbook from "@/public/landing-assets/guided-demo/macbook-gpt-v3.json";
import { STORY_ASSETS } from "@/components/landing-story/asset-paths";
export const metadata: Metadata = {
  title: "BizBox — Test your business before you commit.",
  description:
    "Compare locations and test a business decision with a consultant and a sandbox.",
  robots: { index: false, follow: false },
};
export default function LandingStoryPage() {
  // Match the picture's responsive selection exactly: one early laptop request,
  // without a full-resolution duplicate or a cold runtime image transform.
  preload(STORY_ASSETS.macbook.src, {
    as: "image",
    type: "image/webp",
    imageSrcSet: STORY_ASSETS.macbook.imageSrcSet,
    imageSizes: STORY_ASSETS.macbook.sizes,
    fetchPriority: "high",
  });
  return (
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
      macbook={{ ...macbook, image: STORY_ASSETS.macbook.src }}
    />
  );
}
