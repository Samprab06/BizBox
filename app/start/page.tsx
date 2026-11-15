import type { Metadata } from "next";
import Link from "next/link";
import { BrandLogo } from "@/components/brand/brand-logo";
import { Glass } from "@/components/ui/glass";
import { focusRing } from "@/components/ui/cn";
import { StartGate } from "@/components/landing/start-gate";

export const metadata: Metadata = {
  title: "Get started | BizBox",
  description:
    "Start describing your business, or return to your BizBox workspace.",
};

/** HAC-129: the landing's call-to-action target. */
export default function StartPage() {
  return (
    <div className="min-h-dvh bg-canvas bg-[linear-gradient(var(--color-glass-fill),var(--color-canvas)),url(/brand/background-gradient.webp)] bg-cover bg-center text-ink">
      <header className="px-5 py-5 sm:px-8">
        <Link href="/" className={`inline-flex items-center ${focusRing}`}>
          <BrandLogo onDark priority className="h-8 w-auto" />
        </Link>
      </header>
      <main className="mx-auto flex min-h-[60dvh] max-w-xl flex-col items-center justify-center px-5 text-center">
        <Glass className="w-full p-5 sm:p-8">
          <StartGate />
        </Glass>
      </main>
    </div>
  );
}
