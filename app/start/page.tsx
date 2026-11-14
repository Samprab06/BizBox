import type { Metadata } from "next";
import Link from "next/link";
import { StartGate } from "@/components/landing/start-gate";

export const metadata: Metadata = {
  title: "Get started | BizBox",
  description:
    "Start describing your business, or return to your BizBox workspace.",
};

/** HAC-129: the landing's call-to-action target. */
export default function StartPage() {
  return (
    <div className="min-h-dvh bg-[#10131b] text-white">
      <header className="px-5 py-5 sm:px-8">
        <Link
          href="/"
          className="text-xl font-bold tracking-tight focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
        >
          BizBox
        </Link>
      </header>
      <main className="mx-auto flex min-h-[60dvh] max-w-xl flex-col items-center justify-center px-5 text-center">
        <StartGate />
      </main>
    </div>
  );
}
