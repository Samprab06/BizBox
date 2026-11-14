import type { Metadata } from "next";
import Link from "next/link";
import { BrandLogo } from "@/components/brand/brand-logo";
import { StartGate } from "@/components/landing/start-gate";

export const metadata: Metadata = {
  title: "Get started | BizBox",
  description:
    "Start describing your business, or return to your BizBox workspace.",
};

/** HAC-129: the landing's call-to-action target. */
export default function StartPage() {
  return (
    <div className="min-h-dvh bg-[#10131b] bg-[linear-gradient(rgb(16_19_27/0.55),rgb(16_19_27/0.8)),url(/brand/background-gradient.webp)] bg-cover bg-center text-white">
      <header className="px-5 py-5 sm:px-8">
        <Link
          href="/"
          className="inline-flex items-center focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
        >
          <BrandLogo onDark priority className="h-8 w-auto" />
        </Link>
      </header>
      <main className="mx-auto flex min-h-[60dvh] max-w-xl flex-col items-center justify-center px-5 text-center">
        <StartGate />
      </main>
    </div>
  );
}
