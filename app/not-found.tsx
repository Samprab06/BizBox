import type { Metadata } from "next";
import { NotFoundPage } from "@/components/errors/not-found-page";

export const metadata: Metadata = { title: "Page not found | BizBox" };

export default function NotFound() {
  return <NotFoundPage />;
}
