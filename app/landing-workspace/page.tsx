import type { Metadata } from "next";
import { PlatformScreen } from "@/components/landing/platform-screen";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "BizBox — Houston workspace",
};

/** Landing-only composition of the platform's shared, interactive components. */
export default async function LandingWorkspace({
  searchParams,
}: {
  searchParams: Promise<{ site?: string | string[] }>;
}) {
  const { site } = await searchParams;
  return (
    <PlatformScreen
      initialSiteId={typeof site === "string" ? site : undefined}
      tilesetUrl={
        process.env.VEXCEL_API_KEY?.trim()
          ? "/api/vexcel/3d/tileset"
          : undefined
      }
    />
  );
}
