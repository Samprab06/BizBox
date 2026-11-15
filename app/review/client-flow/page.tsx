import type { Metadata } from "next";
import { ClientFlowReview } from "@/components/client-flow-review/review";
export const metadata: Metadata = {
  title: "BizBox · Client flow review",
  robots: { index: false, follow: false },
};
export default function Page() {
  return <ClientFlowReview />;
}
