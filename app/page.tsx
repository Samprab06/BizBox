import type { Metadata } from "next";
import LandingStoryPage from "./landing-story/page";

export const metadata: Metadata = {
  title: "BizBox — Test your business before you commit.",
  description:
    "Compare locations, understand the tradeoffs and simulate business decisions before you commit.",
  robots: { index: true, follow: true },
};

export default function HomePage() {
  return <LandingStoryPage />;
}
