import Link from "next/link";
import { BrandLogo } from "@/components/brand/brand-logo";
import { Card } from "@/components/ui/card";
import { buttonSizes, buttonVariants } from "@/components/ui/button";
import { focusRing, pressable } from "@/components/ui/cn";

export function NotFoundPage({ mapHref }: { mapHref?: string }) {
  return (
    <>
      <header className="border-b border-line bg-canvas px-5 py-4 sm:px-8">
        <Link href="/" className={`inline-flex rounded-control ${focusRing}`}>
          <BrandLogo onDark />
        </Link>
      </header>
      <main className="mx-auto w-full max-w-2xl px-5 py-12 sm:px-8">
        <Card
          role="region"
          aria-labelledby="not-found-title"
          className="space-y-4"
        >
          <p className="text-sm font-medium text-muted">404</p>
          <h1
            id="not-found-title"
            className="text-3xl font-semibold tracking-tight"
          >
            Page not found
          </h1>
          <p className="text-muted">
            {mapHref
              ? "This page isn’t available in this project. Return to the map to choose a location."
              : "This page isn’t available. Return home to continue with BizBox."}
          </p>
          <div className="flex flex-wrap items-center gap-4 pt-2">
            <Link
              href={mapHref ?? "/"}
              prefetch={false}
              className={`inline-flex items-center justify-center rounded-control ${buttonVariants.primary} ${buttonSizes.md} ${focusRing} ${pressable}`}
            >
              {mapHref ? "Back to project map" : "Go home"}
            </Link>
            {mapHref && (
              <Link
                href="/"
                className={`rounded-control text-accent underline ${focusRing}`}
              >
                Go home
              </Link>
            )}
          </div>
        </Card>
      </main>
    </>
  );
}
