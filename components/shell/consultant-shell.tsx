"use client";

import { usePathname, useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { AssistantPanel } from "@/components/workspace-screen/assistant-panel";
import {
  workspaceHeader,
  type AssistantMode,
} from "@/components/workspace-screen/model";
import {
  useIntakeConversation,
  type IntakeConversation,
} from "@/components/workspace-screen/use-intake-conversation";
import type { UiAction } from "@/lib/contracts/agent";
import { useAnswerCard } from "./answer-cards";
import { selectedSiteFromLocation } from "./consultant-location";
import {
  firstNavigate,
  isBriefComplete,
  isEntryPath,
  navigateHref,
  spacesHref,
} from "./entry-flow";
import type { PreviewProject } from "@/lib/contracts/workspace-preview";
import { VOICE_LIMITS, type VoiceAdapter } from "@/lib/voice/contracts";

/**
 * HAC-143: the persistent consultant. The project layout mounts this once, so the
 * conversation (history, draft, in-flight request, queue), the Text/Voice mode and a running
 * voice session survive client navigation between every project route. The URL stays the
 * current step; the shell only decides where the consultant sits:
 *
 * - `docked`: the step's view beside the consultant (about 68/32 from 768 px; below that the
 *   consultant is a bottom sheet the founder opens and closes);
 * - `focus`: the consultant fills the page and the view is hidden (still mounted).
 */
export type ConsultantLayout = "focus" | "docked";

type ConsultantContextValue = {
  conversation: IntakeConversation;
  /** A screen can take over voice answers (e.g. the intake form's prompt-guarded answers). */
  registerVoice: (adapter: VoiceAdapter | null) => void;
  layout: ConsultantLayout;
  setLayout: (layout: ConsultantLayout) => void;
};

const ConsultantContext = createContext<ConsultantContextValue | null>(null);

/** The project's consultant, or null outside a project layout. */
export function useConsultant() {
  return useContext(ConsultantContext);
}

/** Routes the dock's voice transcripts to this screen while it is mounted. */
export function useConsultantVoice(adapter: VoiceAdapter) {
  const consultant = useConsultant();
  const register = consultant?.registerVoice;
  const latest = useRef(adapter);
  useEffect(() => {
    latest.current = adapter;
  }, [adapter]);
  useEffect(() => {
    if (!register) return;
    register({
      readContext: () => latest.current.readContext(),
      submitTranscript: (text) => latest.current.submitTranscript(text),
    });
    return () => register(null);
  }, [register]);
}

const subscribeNever = () => () => {};

export const consultantLayoutKey = (projectId: string) =>
  `bizbox:consultant-layout:v1:${projectId}`;

function useConsultantLayout(projectId: string, entry: boolean) {
  const key = consultantLayoutKey(projectId);
  // HAC-150: the project's entry route opens the chat full screen.
  const [layout, setState] = useState<ConsultantLayout>(
    entry ? "focus" : "docked",
  );
  useEffect(() => {
    // The entry route decides its own layout from the brief, not from a saved one.
    if (entry) return;
    let saved: string | null = null;
    try {
      saved = sessionStorage.getItem(key);
    } catch {
      // Blocked storage: the layout lasts until reload.
    }
    // Read after mount so the server render and first client render agree.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (saved === "focus" || saved === "docked") setState(saved);
  }, [key, entry]);
  const setLayout = useCallback(
    (next: ConsultantLayout) => {
      setState(next);
      try {
        sessionStorage.setItem(key, next);
      } catch {
        // Blocked storage: the layout lasts until reload.
      }
    },
    [key],
  );
  return [layout, setLayout] as const;
}

function ExpandIcon({ focus }: { focus: boolean }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      aria-hidden="true"
      className="size-4"
    >
      {focus ? (
        <path
          d="M8 3v5H3M12 3v5h5M8 17v-5H3M12 17v-5h5"
          strokeLinecap="round"
        />
      ) : (
        <path
          d="M3 8V3h5M17 8V3h-5M3 12v5h5M17 12v5h-5"
          strokeLinecap="round"
        />
      )}
    </svg>
  );
}

const focusRing =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-viewport-ink";

export function ConsultantShell({
  projectId,
  project,
  children,
}: {
  projectId: string;
  project: PreviewProject | null;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const entry = isEntryPath(pathname, projectId);
  // HAC-150: the first `navigate` action docks the consultant and opens that step. The
  // handler is read through a ref because it needs the conversation this call creates.
  const actionsRef = useRef<(actions: UiAction[]) => void>(() => {});
  const onActions = useCallback(
    (actions: UiAction[]) => actionsRef.current(actions),
    [],
  );
  const conversation = useIntakeConversation(projectId, onActions);
  const [layout, setLayout] = useConsultantLayout(projectId, entry);
  const layoutRef = useRef(layout);
  useEffect(() => {
    layoutRef.current = layout;
  }, [layout]);
  const [transition, setTransition] = useState<"none" | "animated" | "cut">(
    "none",
  );
  const mainRef = useRef<HTMLElement>(null);
  const dockRef = useRef<HTMLDivElement>(null);
  /** Docks the consultant; `animate` is false for a returning founder, who starts docked. */
  const dock = useCallback(
    (animate: boolean) => {
      const reduce = window.matchMedia(
        "(prefers-reduced-motion: reduce)",
      ).matches;
      setTransition(!animate ? "none" : reduce ? "cut" : "animated");
      setLayout("docked");
    },
    [setLayout],
  );
  useEffect(() => {
    actionsRef.current = (actions) => {
      const navigate = firstNavigate(actions);
      if (!navigate || layoutRef.current !== "focus") return;
      dock(true);
      router.push(navigateHref(projectId, navigate));
    };
  }, [dock, projectId, router]);
  // The animation is a short fade-and-rise of the step view and the dock. Reduced motion gets
  // a cut: `transition` is "cut", so no animation runs at all.
  useEffect(() => {
    if (layout !== "docked" || transition !== "animated") return;
    const keyframes = [
      { opacity: 0, transform: "translateY(10px)" },
      { opacity: 1, transform: "none" },
    ];
    const options = { duration: 320, easing: "ease-out" } as const;
    mainRef.current?.animate?.(keyframes, options);
    dockRef.current?.animate?.(keyframes, options);
  }, [layout, transition]);
  // The brief becoming complete docks the consultant. A complete brief found on arrival
  // (a returning founder) docks at once with no animation; completing it here animates.
  const loaded = useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false,
  );
  // A first visit has no saved session yet; the entry starts the brief with the assistant's
  // opening question, which the answer cards and the chat then build on.
  const { session, read, save } = conversation;
  useEffect(() => {
    if (loaded && entry && !session) save(read());
  }, [loaded, entry, session, read, save]);
  const complete = isBriefComplete(session?.profile);
  const wasComplete = useRef<boolean | null>(null);
  useEffect(() => {
    if (!loaded) return;
    const before = wasComplete.current;
    wasComplete.current = complete;
    if (!complete) return;
    if (entry) {
      dock(before === false);
      router.replace(spacesHref(projectId));
    } else if (before === false && layoutRef.current === "focus") {
      dock(true);
    }
  }, [loaded, complete, entry, dock, router, projectId]);
  const answerCard = useAnswerCard(conversation);
  const [mode, setMode] = useState<AssistantMode>("text");
  const [sheetOpen, setSheetOpen] = useState(false);
  // On a phone the sheet covers the step, so moving to another step closes it. The panel
  // stays mounted, so the conversation and a running voice session are unaffected.
  const [sheetPath, setSheetPath] = useState(pathname);
  if (sheetPath !== pathname) {
    setSheetPath(pathname);
    setSheetOpen(false);
  }
  const sheetId = useId();
  const pageVoice = useRef<VoiceAdapter | null>(null);
  const registerVoice = useCallback((adapter: VoiceAdapter | null) => {
    pageVoice.current = adapter;
  }, []);
  const focus = layout === "focus";

  const viewRef = useRef(conversation.view);
  useEffect(() => {
    viewRef.current = conversation.view;
  }, [conversation.view]);
  const sessionRef = useRef(conversation.session);
  useEffect(() => {
    sessionRef.current = conversation.session;
  }, [conversation.session]);
  const submitRef = useRef(conversation.submit);
  useEffect(() => {
    submitRef.current = conversation.submit;
  }, [conversation.submit]);

  // One voice adapter for the project. The context is read when voice asks for it, so it
  // always describes the current route without re-rendering on every navigation.
  const voiceAdapter = useMemo<VoiceAdapter>(
    () => ({
      readContext: () => {
        if (pageVoice.current)
          return { ...pageVoice.current.readContext(), view: viewRef.current };
        const selectedSiteId = selectedSiteFromLocation(
          window.location.pathname,
          window.location.search,
        );
        const header = workspaceHeader(sessionRef.current, project);
        const site = project?.sites.find(
          (entry) => entry.id === selectedSiteId,
        );
        const summary = [
          `City: ${header.city}`,
          `Business: ${header.business}`,
          header.budget,
          site ? `Selected space: ${site.address}` : "No space selected",
        ].join(". ");
        return {
          projectId,
          mode: "chat",
          view: viewRef.current,
          ...(selectedSiteId ? { selectedSiteId } : {}),
          summary: summary.slice(0, VOICE_LIMITS.summaryChars),
        };
      },
      submitTranscript: (text) =>
        pageVoice.current
          ? pageVoice.current.submitTranscript(text)
          : submitRef.current(text),
    }),
    [project, projectId],
  );

  const context = useMemo(
    () => ({ conversation, registerVoice, layout, setLayout }),
    [conversation, registerVoice, layout, setLayout],
  );

  const toggleLayout = (
    <button
      type="button"
      onClick={() => setLayout(focus ? "docked" : "focus")}
      aria-label={focus ? "Show the current step" : "Expand the assistant"}
      title={focus ? "Show the current step" : "Expand the assistant"}
      className={`grid size-8 place-items-center rounded-full border border-viewport-line text-viewport-muted hover:text-viewport-ink ${focusRing}`}
    >
      <ExpandIcon focus={focus} />
    </button>
  );

  const status =
    conversation.availability === "checking"
      ? "Checking"
      : conversation.availability === "live"
        ? "Live"
        : "Offline";

  return (
    <ConsultantContext.Provider value={context}>
      <div
        data-consultant-layout={layout}
        data-dock-transition={transition}
        className={
          focus
            ? "min-w-0 print:block"
            : "min-w-0 md:grid md:grid-cols-[minmax(0,68fr)_minmax(300px,32fr)] print:block"
        }
      >
        {/* The view stays mounted in focus, so its state is kept for when it returns. */}
        <main
          ref={mainRef}
          // While the phone sheet is open, room below the view lets all of it scroll clear.
          // CSS hiding lets print restore the plan even when the assistant is expanded.
          className={`min-w-0 px-5 pt-7 sm:px-8 md:pb-10 ${focus ? "hidden" : ""} print:block ${sheetOpen ? "pb-[80dvh]" : "pb-24"}`}
        >
          {children}
        </main>
        <div
          ref={dockRef}
          className={
            focus
              ? "mx-auto flex h-[calc(100dvh-4rem)] w-full max-w-3xl min-w-0 flex-col p-3 sm:p-5 print:hidden"
              : "fixed inset-x-0 bottom-0 z-40 flex max-h-[80dvh] min-w-0 flex-col border-t border-viewport-line bg-viewport-canvas md:sticky md:top-16 md:z-auto md:h-[calc(100dvh-4rem)] md:max-h-none md:border-t-0 md:bg-transparent md:p-4 md:pl-0 print:hidden"
          }
        >
          {!focus && (
            <button
              type="button"
              aria-expanded={sheetOpen}
              aria-controls={sheetId}
              onClick={() => setSheetOpen((open) => !open)}
              className={`flex w-full shrink-0 items-center justify-between gap-3 px-5 py-3 text-left text-sm font-semibold text-viewport-ink md:hidden ${focusRing}`}
            >
              <span>
                {sheetOpen ? "Hide assistant" : "Open assistant"}
                <span className="ml-2 rounded border border-viewport-line px-1.5 py-0.5 text-[11px] font-normal text-viewport-muted">
                  {status}
                </span>
              </span>
              <svg
                viewBox="0 0 20 20"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                aria-hidden="true"
                className={`size-4 motion-safe:transition-transform ${sheetOpen ? "rotate-180" : ""}`}
              >
                <path d="m5 12 5-5 5 5" strokeLinecap="round" />
              </svg>
            </button>
          )}
          {/* Collapsed on a phone, the panel is hidden but stays mounted (voice keeps running). */}
          <div
            id={sheetId}
            className={`min-h-0 flex-1 flex-col ${focus ? "flex h-full" : sheetOpen ? "flex h-[70dvh] md:h-auto" : "hidden md:flex"}`}
          >
            <AssistantPanel
              projectId={projectId}
              conversation={conversation}
              mode={mode}
              onModeChange={setMode}
              voiceAdapter={voiceAdapter}
              actions={toggleLayout}
              inline={focus ? answerCard : undefined}
              className="h-full min-h-0 md:min-h-[420px]"
            />
          </div>
        </div>
      </div>
    </ConsultantContext.Provider>
  );
}
