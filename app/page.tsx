import type { Metadata } from "next";
import LandingStoryPage from "./landing-story/page";

export const metadata: Metadata = {
  title: "BizBox — Test your business before you commit.",
  description:
    "Compare real storefronts in Houston and Los Angeles and simulate business decisions before signing a lease.",
  robots: { index: true, follow: true },
};

export default function HomePage() {
  return <LandingStoryPage />;
}
