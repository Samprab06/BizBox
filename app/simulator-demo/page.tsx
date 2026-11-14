import { redirect } from "next/navigation";
import {
  simulatorDestination,
  type SimulatorSearch,
} from "@/components/simulator/destination";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<SimulatorSearch>;
}) {
  redirect(simulatorDestination(await searchParams));
}
