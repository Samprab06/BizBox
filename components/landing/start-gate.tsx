"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useSyncExternalStore } from "react";
import {
  intakeStorageKey,
  parseIntakeSession,
} from "@/components/workspace-screen/intake-conversation";
import { ENTRY_PROJECT_ID, entryTarget } from "./entry";

const subscribe = () => () => {};

function readRaw(projectId: string): string | null {
  try {
    return localStorage.getItem(intakeStorageKey(projectId));
  } catch {
    return null;
  }
}

const primary =
  "rounded-full bg-white px-6 py-3 text-sm font-semibold text-[#10131b] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white";
const secondary =
  "rounded-full px-5 py-3 text-sm font-medium text-white/90 underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white";

/**
 * /start: a first visit goes straight into the guided onboarding; a visitor with a saved
 * intake session gets a direct path back into their workspace. Reads the existing session
 * only; nothing is written.
 */
export function StartGate({
  projectId = ENTRY_PROJECT_ID,
}: {
  projectId?: string;
}) {
  const router = useRouter();
  const ready = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
  const target = ready
    ? entryTarget(parseIntakeSession(readRaw(projectId)), projectId)
    : null;
  const href = target?.kind === "onboarding" ? target.href : null;

  useEffect(() => {
    if (href) router.replace(href);
  }, [href, router]);

  if (target?.kind !== "returning") {
    return (
      <p role="status" className="text-white/80">
        Opening BizBox…
      </p>
    );
  }
  return (
    <>
      <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
        Welcome back to BizBox
      </h1>
      <p className="mt-3 max-w-md text-white/75">
        {target.complete
          ? "Your business profile is saved on this device. Pick up where you left off."
          : "You started describing your business. Finish onboarding or jump to your workspace."}
      </p>
      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
        {target.complete ? (
          <>
            <Link href={target.workspaceHref} className={primary}>
              Open your workspace
            </Link>
            <Link href={target.onboardingHref} className={secondary}>
              Review your answers
            </Link>
          </>
        ) : (
          <>
            <Link href={target.onboardingHref} className={primary}>
              Continue onboarding
            </Link>
            <Link href={target.workspaceHref} className={secondary}>
              Open your workspace
            </Link>
          </>
        )}
      </div>
    </>
  );
}
