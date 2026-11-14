import { SimulatorDemo } from "@/components/simulator/demo";
import { demoPlan, makeDemo } from "@/components/simulator/fixture";
import { getSiteFixture } from "@/components/site/site-fixtures";

export const dynamic = "force-dynamic";

export default function Page() {
  const site = getSiteFixture("montrose");
  const tilesetUrl = process.env.VEXCEL_API_KEY?.trim()
    ? "/api/vexcel/3d/tileset"
    : undefined;
  const coordinates =
    site && tilesetUrl
      ? { longitude: site.longitude, latitude: site.latitude, tilesetUrl }
      : undefined;
  return (
    <SimulatorDemo
      data={makeDemo()}
      plan={demoPlan}
      coordinates={coordinates}
    />
  );
}
