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
import {
  canOpenStep,
  flowStepFromLocation,
  flowStepHref,
  readFlowState,
} from "@/lib/client/flow-progress";
import { selectedSiteFromLocation } from "./consultant-location";
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
 * - `focus`: the founder expanded the consultant; the view is hidden (still mounted).
 *
 * Scene 1: the questionnaire (`/intake`) shows no dock at all, only the page at full width;
 * the conversation still runs here so the questionnaire can use it. Every other step opens
 * docked, and the workspace registers the handler that carries out the consultant's actions.
 */
export type ConsultantLayout = "focus" | "docked";

export type ActionHandler = (actions: UiAction[]) => void;

type ConsultantContextValue = {
  conversation: IntakeConversation;
  /** A screen can take over voice answers (e.g. the intake form's prompt-guarded answers). */
  registerVoice: (adapter: VoiceAdapter | null) => void;
  layout: ConsultantLayout;
  setLayout: (layout: ConsultantLayout) => void;
  /** Scene 1: the mounted workspace carries out the consultant's UI actions. */
  registerActions: (handler: ActionHandler | null) => void;
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

/** Scene 1: sends the consultant's UI actions to this screen while it is mounted. */
export function useConsultantActions(handler: ActionHandler) {
  const register = useConsultant()?.registerActions;
  const latest = useRef(handler);
  useEffect(() => {
    latest.current = handler;
  }, [handler]);
  useEffect(() => {
    if (!register) return;
    register((actions) => latest.current(actions));
    return () => register(null);
  }, [register]);
}

export const consultantLayoutKey = (projectId: string) =>
  `bizbox:consultant-layout:v1:${projectId}`;

function useConsultantLayout(projectId: string) {
  const key = consultantLayoutKey(projectId);
  const [layout, setState] = useState<ConsultantLayout>("docked");
  useEffect(() => {
    let saved: string | null = null;
    try {
      saved = sessionStorage.getItem(key);
    } catch {
      // Blocked storage: the layout lasts until reload.
    }
    // Read after mount so the server render and first client render agree.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (saved === "focus" || saved === "docked") setState(saved);
  }, [key]);
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
  companion,
  children,
}: {
  projectId: string;
  project: PreviewProject | null;
  /**
   * Consultant panels shown under the assistant in the same dock, e.g. HAC-84's copilot
   * (scenario, plan, proposed changes). They persist across navigation with the shell.
   */
  companion?: React.ReactNode;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  // Scene 1: the questionnaire has no chat, so the dock is hidden there entirely.
  const hidden = flowStepFromLocation(pathname, "") === "questions";
  // The workspace registers the handler for the consultant's actions while it is mounted.
  // Elsewhere only a guided-flow step change is honoured; navigate-away actions are not.
  const pageActions = useRef<ActionHandler | null>(null);
  const registerActions = useCallback((handler: ActionHandler | null) => {
    pageActions.current = handler;
  }, []);
  const onActions = useCallback(
    (actions: UiAction[]) => {
      if (pageActions.current) return pageActions.current(actions);
      const go = actions.find(
        (action): action is Extract<UiAction, { type: "go_to_step" }> =>
          action.type === "go_to_step",
      );
      if (go && canOpenStep(readFlowState(projectId), go.step))
        router.push(flowStepHref(projectId, go.step));
    },
    [projectId, router],
  );
  const conversation = useIntakeConversation(projectId, onActions);
  const [layout, setLayout] = useConsultantLayout(projectId);
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
    () => ({ conversation, registerVoice, layout, setLayout, registerActions }),
    [conversation, registerVoice, layout, setLayout, registerActions],
  );

  if (hidden)
    return (
      <ConsultantContext.Provider value={context}>
        <div data-consultant-layout="hidden" className="min-w-0">
          <main className="min-w-0 px-5 pt-7 pb-10 sm:px-8">{children}</main>
        </div>
      </ConsultantContext.Provider>
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
        className={
          focus
            ? "min-w-0 print:block"
            : "min-w-0 md:grid md:grid-cols-[minmax(0,68fr)_minmax(300px,32fr)] print:block"
        }
      >
        {/* The view stays mounted in focus, so its state is kept for when it returns. */}
        <main
          // While the phone sheet is open, room below the view lets all of it scroll clear.
          // CSS hiding lets print restore the plan even when the assistant is expanded.
          className={`min-w-0 px-5 pt-7 sm:px-8 md:pb-10 ${focus ? "hidden" : ""} print:block ${sheetOpen ? "pb-[80dvh]" : "pb-24"}`}
        >
          {children}
        </main>
        <div
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
            className={`min-h-0 flex-1 flex-col ${companion ? "overflow-y-auto overscroll-contain" : ""} ${focus ? "flex h-full" : sheetOpen ? "flex h-[70dvh] md:h-auto" : "hidden md:flex"}`}
          >
            <AssistantPanel
              projectId={projectId}
              conversation={conversation}
              mode={mode}
              onModeChange={setMode}
              voiceAdapter={voiceAdapter}
              actions={toggleLayout}
              className={
                companion
                  ? "min-h-[420px] flex-1 shrink-0"
                  : "h-full min-h-0 md:min-h-[420px]"
              }
            />
            {companion && <div className="shrink-0">{companion}</div>}
          </div>
        </div>
      </div>
    </ConsultantContext.Provider>
  );
}
