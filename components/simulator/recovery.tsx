"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { useConsultant } from "@/components/shell/consultant-shell";
import { Card } from "@/components/ui/card";
import { buttonSizes, buttonVariants } from "@/components/ui/button";
import { cn, focusRing, pressable } from "@/components/ui/cn";

/** Recovery reveals the view once; it preserves the shell, conversation and replay ownership. */
export function SimulatorRecovery({
  kind,
  workspaceHref,
  exampleHref,
  retryHref,
}: {
  kind: "not_found" | "error";
  workspaceHref: string;
  exampleHref: string;
  retryHref: string;
}) {
  const reveal = useConsultant()?.setLayout;
  const revealed = useRef(false);
  useEffect(() => {
    if (reveal && !revealed.current) {
      revealed.current = true;
      reveal("docked");
    }
  }, [reveal]);
  const error = kind === "error";
  const linkClass = cn(
    "inline-flex items-center justify-center rounded-control",
    pressable,
    focusRing,
    buttonVariants.glass,
    buttonSizes.md,
  );
  return (
    <Card
      className="p-6"
      role="alert"
      aria-labelledby="simulator-recovery-title"
    >
      <h2 id="simulator-recovery-title" className="text-xl font-semibold">
        {error ? "Comparison temporarily unavailable" : "Comparison not found"}
      </h2>
      <p className="mt-3 text-sm text-muted">
        {error
          ? "We could not load this saved comparison. Try again to reopen its recorded simulation."
          : "This comparison is unavailable for this project. Return to your workspace to choose a saved comparison."}
      </p>
      <div className="mt-5 flex flex-wrap gap-3">
        {error && (
          <a href={retryHref} className={linkClass}>
            Retry
          </a>
        )}
        <Link href={workspaceHref} prefetch={false} className={linkClass}>
          Back to workspace
        </Link>
        <Link href={exampleHref} prefetch={false} className={linkClass}>
          Open the example
        </Link>
      </div>
    </Card>
  );
}
