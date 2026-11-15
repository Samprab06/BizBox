"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  intakeStorageKey,
  parseIntakeSession,
} from "@/components/workspace-screen/intake-conversation";
import { entryPath } from "@/components/shell/entry-flow";
import { workspaceHref } from "@/lib/client/workspace-routes";
import { DEMO_PROJECT_ID, isGeneratedProjectId } from "@/lib/projects/ids";
import { CURRENT_PROJECT_KEY, entryPlan } from "./entry";

const subscribe = () => () => {};

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function rememberProject(projectId: string) {
  try {
    localStorage.setItem(CURRENT_PROJECT_KEY, projectId);
  } catch {
    // Private mode: the founder still lands on their project; only resuming is lost.
  }
}

/** HAC-136: asks the server for a new project row and returns its ID. */
async function createProject(): Promise<string> {
  const response = await fetch("/api/projects", {
    method: "POST",
    cache: "no-store",
  });
  if (!response.ok) throw new Error("project unavailable");
  const body = (await response.json()) as { id?: unknown };
  if (typeof body.id !== "string" || !isGeneratedProjectId(body.id))
    throw new Error("unexpected project id");
  return body.id;
}

const primary =
  "rounded-full bg-white px-6 py-3 text-sm font-semibold text-[#10131b] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white";
const secondary =
  "rounded-full px-5 py-3 text-sm font-medium text-white/90 underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white";

/**
 * /start: a first visit gets a new project and goes straight into the chat-first entry
 * (HAC-150); a founder with a complete brief lands docked; one with a started brief chooses
 * between continuing the chat and the workspace.
 */
export function StartGate() {
  const router = useRouter();
  const ready = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
  const target = ready
    ? entryPlan(read(CURRENT_PROJECT_KEY), (projectId) =>
        parseIntakeSession(read(intakeStorageKey(projectId))),
      )
    : null;
  // HAC-150: a first visit opens the chat; a returning founder with a complete brief goes
  // to the same entry, which docks straight onto Spaces.
  const href =
    target?.kind === "onboarding"
      ? target.href
      : target?.kind === "returning" && target.complete
        ? target.onboardingHref
        : null;
  const create = target?.kind === "create";
  const [attempt, setAttempt] = useState(0);
  const [failedAttempt, setFailedAttempt] = useState<number | null>(null);
  const failed = failedAttempt === attempt;
  // One request per attempt, even when Strict Mode runs the effect twice.
  const creating = useRef(false);

  useEffect(() => {
    if (href) router.replace(href);
  }, [href, router]);

  useEffect(() => {
    if (!create || creating.current) return;
    creating.current = true;
    createProject().then(
      (projectId) => {
        rememberProject(projectId);
        router.replace(entryPath(projectId));
      },
      () => {
        creating.current = false;
        setFailedAttempt(attempt);
      },
    );
  }, [create, attempt, router]);

  if (create && failed) {
    return (
      <>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          BizBox could not start your project
        </h1>
        <p role="alert" className="mt-3 max-w-md text-white/75">
          Your new project could not be created just now. Try again, or look
          around the example project first.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <button
            type="button"
            className={primary}
            onClick={() => setAttempt((n) => n + 1)}
          >
            Try again
          </button>
          <Link
            href={workspaceHref(DEMO_PROJECT_ID, "intake")}
            className={secondary}
          >
            Open the example project
          </Link>
        </div>
      </>
    );
  }

  if (target?.kind !== "returning" || target.complete) {
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
        You started describing your business. Pick up the conversation or jump
        to your workspace.
      </p>
      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
        <Link href={target.onboardingHref} className={primary}>
          Continue the conversation
        </Link>
        <Link href={target.workspaceHref} className={secondary}>
          Open your workspace
        </Link>
      </div>
    </>
  );
}
