import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { closeConsultant, expect, openConsultant, test } from "./fixtures";

type Harness = {
  deny: boolean;
  failureName: string | null;
  pendingMic: boolean;
  releaseMicrophone(): void;
  disconnectMicrophone(): void;
  disconnectPeer(): void;
  gets: number;
  stopped: number;
  peersClosed: number;
  channelsClosed: number;
  contextsClosed: number;
  sent: Record<string, unknown>[];
  emit(event: unknown): void;
  complete(id: string, text: string): void;
  beginReply(): void;
  finishReply(): void;
};
declare global {
  interface Window {
    __voice: Harness;
  }
}

/** Browser boundaries only: no microphone, peer network or paid service is used. */
async function mockVoice(
  page: Page,
  options: {
    configured?: boolean;
    denied?: boolean;
    noWebGL?: boolean;
    pendingMic?: boolean;
    failureName?: string;
    unsupported?: boolean;
  } = {},
) {
  await page.addInitScript(
    ({ denied, noWebGL, pendingMic, failureName, unsupported }) => {
      let channel: FakeChannel;
      let disconnectPeer = () => {};
      let track: FakeTrack;
      let releaseMicrophone: (() => void) | undefined;
      let previous: string | null = null;
      let responseId = 0;
      const h: Harness = (window.__voice = {
        deny: denied,
        failureName: failureName ?? null,
        pendingMic,
        releaseMicrophone() {
          releaseMicrophone?.();
        },
        disconnectMicrophone() {
          track.readyState = "ended";
          track.dispatchEvent(new Event("ended"));
        },
        disconnectPeer() {
          disconnectPeer();
        },
        gets: 0,
        stopped: 0,
        peersClosed: 0,
        channelsClosed: 0,
        contextsClosed: 0,
        sent: [],
        emit(event) {
          channel?.onmessage?.({ data: JSON.stringify(event) });
        },
        complete(id, text) {
          h.emit({
            type: "input_audio_buffer.committed",
            item_id: id,
            previous_item_id: previous,
          });
          previous = id;
          h.emit({
            type: "conversation.item.input_audio_transcription.completed",
            item_id: id,
            content_index: 0,
            transcript: text,
          });
        },
        beginReply() {
          const request = h.sent.findLast(
            (event) => event.type === "response.create",
          ) as { response: { metadata: Record<string, unknown> } };
          h.emit({
            type: "response.created",
            response: {
              id: `reply-${++responseId}`,
              metadata: request.response.metadata,
            },
          });
        },
        finishReply() {
          h.beginReply();
          h.emit({
            type: "output_audio_buffer.stopped",
            response_id: `reply-${responseId}`,
          });
        },
      });
      class FakeChannel {
        readyState = "open";
        onopen = null;
        onclose = null;
        onerror = null;
        onmessage: ((event: { data: string }) => void) | null = null;
        send(text: string) {
          h.sent.push(JSON.parse(text));
        }
        close() {
          h.channelsClosed++;
        }
      }
      class FakePeer {
        constructor() {
          disconnectPeer = () => {
            this.connectionState = "disconnected";
            this.onconnectionstatechange?.();
          };
        }
        connectionState = "connected";
        ontrack = null;
        onconnectionstatechange: (() => void) | null = null;
        addTrack() {}
        createDataChannel() {
          channel = new FakeChannel();
          return channel;
        }
        async createOffer() {
          return { type: "offer", sdp: "v=0\r\nmock-offer" };
        }
        async setLocalDescription() {}
        async setRemoteDescription() {}
        close() {
          h.peersClosed++;
        }
      }
      class FakeAudio {
        muted = true;
        autoplay = false;
        srcObject = null;
        async play() {}
        pause() {}
        remove() {}
      }
      class FakeAudioContext {
        createMediaStreamSource() {
          return { connect() {}, disconnect() {} };
        }
        createAnalyser() {
          return {
            fftSize: 512,
            getFloatTimeDomainData(data: Float32Array) {
              data.fill(0.08);
            },
            disconnect() {},
          };
        }
        async resume() {}
        async close() {
          h.contextsClosed++;
        }
      }
      Object.defineProperty(window, "RTCPeerConnection", {
        value: FakePeer,
        configurable: true,
      });
      Object.defineProperty(window, "Audio", {
        value: FakeAudio,
        configurable: true,
      });
      Object.defineProperty(window, "AudioContext", {
        value: FakeAudioContext,
        configurable: true,
      });
      class FakeTrack extends EventTarget {
        enabled = true;
        readyState: MediaStreamTrackState = "live";
        stop() {
          this.readyState = "ended";
          h.stopped++;
        }
      }
      Object.defineProperty(navigator, "mediaDevices", {
        value: unsupported
          ? undefined
          : {
              async getUserMedia() {
                h.gets++;
                if (h.pendingMic)
                  await new Promise<void>((resolve) => {
                    releaseMicrophone = resolve;
                  });
                if (h.deny) throw new DOMException("Denied", "NotAllowedError");
                if (h.failureName)
                  throw new DOMException(
                    "Private device details",
                    h.failureName,
                  );
                track = new FakeTrack();
                return {
                  getTracks: () => [track],
                  getAudioTracks: () => [track],
                };
              },
            },
        configurable: true,
      });
      if (noWebGL) {
        const getContext = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function (
          this: HTMLCanvasElement,
          ...args: Parameters<typeof getContext>
        ) {
          if (String(args[0]).startsWith("webgl")) return null;
          return getContext.apply(this, args);
        } as typeof getContext;
      }
    },
    {
      denied: options.denied ?? false,
      noWebGL: options.noWebGL ?? false,
      pendingMic: options.pendingMic ?? false,
      failureName: options.failureName,
      unsupported: options.unsupported ?? false,
    },
  );
  let setups = 0;
  await page.route("**/api/voice/session", (route) => {
    if (route.request().method() === "GET")
      return route.fulfill({
        json: { configured: options.configured ?? true },
      });
    setups++;
    return route.fulfill({
      json: { answerSdp: "v=0\r\nmock-answer", sessionSeconds: 180 },
    });
  });
  await page.route("**/api/projects/*/intake", (route) =>
    route.fulfill({ json: { modelConfigured: false } }),
  );
  return () => setups;
}
// HAC-143: the intake form has no voice panel of its own; the consultant dock's one voice
// session answers the form's current prompt while the form is open.
const voice = (page: Page) =>
  page.getByRole("region", { name: "Voice assistant", exact: true });
async function openIntakeForm(page: Page) {
  await page.goto("/projects/houston-coffee/intake?mode=form");
  await openConsultant(page);
  await page
    .getByRole("complementary", { name: "Assistant" })
    .getByRole("tab", { name: "Voice" })
    .click();
  await expect(voice(page)).toBeVisible();
}
const profileConcept = (page: Page) =>
  page.getByRole("textbox", { name: "Business concept", exact: true });
async function start(page: Page) {
  await voice(page)
    .getByRole("button", { name: "Start voice", exact: true })
    .click();
  await expect(
    voice(page).getByRole("status", { name: "Voice status" }),
  ).toContainText("Listening");
}

test("unconfigured voice has no microphone/setup side effects and typed intake works", async ({
  page,
}) => {
  const setups = await mockVoice(page, { configured: false });
  await openIntakeForm(page);
  await expect(
    voice(page).getByRole("button", { name: "Start voice" }),
  ).toBeDisabled();
  expect(await page.evaluate(() => window.__voice.gets)).toBe(0);
  expect(setups()).toBe(0);
  await closeConsultant(page);
  await page
    .getByLabel("Your answer · Business concept", { exact: true })
    .fill("Typed café");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(profileConcept(page)).toHaveValue("Typed café");
});

test("voice and typed answers share the current offline profile, validation and context", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await mockVoice(page);
  await openIntakeForm(page);
  await start(page);
  await page.evaluate(() => window.__voice.complete("A", "Voice café"));
  await expect(profileConcept(page)).toHaveValue("Voice café");
  await expect(
    page
      .getByRole("complementary", { name: "Project context", exact: true })
      .getByRole("link", { name: "Change business concept: Voice café" }),
  ).toBeVisible();
  const conversation = page.getByRole("list", {
    name: "Conversation",
    exact: true,
  });
  await expect(
    conversation.getByText("Voice café", { exact: true }),
  ).toHaveCount(1);
  await page.evaluate(() => {
    window.__voice.complete("A", "Voice café");
    window.__voice.finishReply();
  });
  await page
    .getByLabel("Your answer · Areas to favor or avoid", { exact: true })
    .fill("Prefer Heights");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(
    page.getByLabel("Areas to favor or avoid", { exact: true }),
  ).toHaveValue("Prefer Heights");
  await page.evaluate(() => window.__voice.complete("B", "not a number"));
  await expect(
    conversation.getByText("Enter a nonnegative whole number.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByLabel("Monthly rent ceiling ($)", { exact: true }),
  ).toHaveValue("");
  await page.evaluate(() => {
    window.__voice.finishReply();
    window.__voice.complete("C", "5000");
  });
  await expect(
    page.getByLabel("Monthly rent ceiling ($)", { exact: true }),
  ).toHaveValue("5000");
  await voice(page)
    .getByRole("button", { name: "Stop voice", exact: true })
    .click();
  expect(await page.evaluate(() => window.__voice.stopped)).toBe(1);
  expect(await page.evaluate(() => window.__voice.peersClosed)).toBe(1);
  expect(await page.evaluate(() => window.__voice.contextsClosed)).toBe(1);
});

test("permission denial permits retry and leaves typed input available", async ({
  page,
}) => {
  const setups = await mockVoice(page, { denied: true });
  await openIntakeForm(page);
  await voice(page).getByRole("button", { name: "Start voice" }).click();
  await expect(voice(page).getByRole("status")).toContainText(
    "Microphone permission was denied",
  );
  expect(setups()).toBe(0);
  await profileConcept(page).fill("Still editable");
  await expect(profileConcept(page)).toHaveValue("Still editable");
  await page.evaluate(() => {
    window.__voice.deny = false;
  });
  await start(page);
  await voice(page)
    .getByRole("button", { name: "Stop voice", exact: true })
    .click();
  expect(setups()).toBe(1);
});

test("mute cancels identified speech without treating its cancellation race as a failed session", async ({
  page,
}) => {
  await mockVoice(page);
  await openIntakeForm(page);
  await start(page);
  await page.evaluate(() => window.__voice.complete("A", "Coffee"));
  await expect(profileConcept(page)).toHaveValue("Coffee");
  await page.evaluate(() => window.__voice.beginReply());
  await expect(voice(page).getByRole("status")).toContainText("Speaking");
  await voice(page)
    .getByRole("button", { name: "Mute microphone", exact: true })
    .click();
  await page.evaluate(() => {
    const cancel = window.__voice.sent.findLast(
      (event) => event.type === "response.cancel",
    )!;
    window.__voice.emit({
      type: "error",
      error: { code: "response_cancel_not_active", event_id: cancel.event_id },
    });
    window.__voice.complete("B", "ignored while muted");
  });
  await expect(
    voice(page).getByRole("button", { name: "Unmute microphone" }),
  ).toBeVisible();
  await expect(
    page.getByLabel("Areas to favor or avoid", { exact: true }),
  ).toHaveValue("");
  await voice(page).getByRole("button", { name: "Unmute microphone" }).click();
  await page.evaluate(() => window.__voice.complete("C", "Montrose"));
  await expect(
    page.getByLabel("Areas to favor or avoid", { exact: true }),
  ).toHaveValue("Montrose");
});

test("live voice uses the typed endpoint and stop suppresses late speech while preserving newer form edits", async ({
  page,
}) => {
  await mockVoice(page);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const bodies: Record<string, unknown>[] = [];
  await page.route("**/api/projects/*/intake", async (route) => {
    if (route.request().method() === "GET")
      return route.fulfill({ json: { modelConfigured: true } });
    const body = route.request().postDataJSON();
    bodies.push(body);
    if (bodies.length === 1) await gate;
    return route.fulfill({
      json: {
        draft: { concept: "Voice idea", category: "coffee", city: "Houston" },
        assumptions: {},
        missingRequiredFields: [],
        findings: [],
        nextQuestion: null,
        assistantMessage: "Actual intake reply",
      },
    });
  });
  await openIntakeForm(page);
  await expect(
    page.getByText("Live intake agent. Answers are kept in this browser."),
  ).toBeVisible();
  await start(page);
  await page.evaluate(() => window.__voice.complete("A", "Voice idea"));
  await expect.poll(() => bodies.length).toBe(1);
  expect(bodies[0].message).toBe("Voice idea");
  await profileConcept(page).fill("Newer manual edit");
  await voice(page)
    .getByRole("button", { name: "Stop voice", exact: true })
    .click();
  release();
  await expect(
    page
      .getByRole("list", { name: "Conversation", exact: true })
      .getByText("Actual intake reply", { exact: true }),
  ).toBeVisible();
  await expect(profileConcept(page)).toHaveValue("Newer manual edit");
  expect(
    await page.evaluate(
      () =>
        window.__voice.sent.filter((event) => event.type === "response.create")
          .length,
    ),
  ).toBe(0);
  const dock = page.getByRole("complementary", { name: "Assistant" });
  await dock.getByRole("tab", { name: "Text" }).click();
  await dock
    .getByLabel("Message the BizBox assistant", { exact: true })
    .fill("Typed follow-up");
  await dock.getByRole("button", { name: "Send message", exact: true }).click();
  await expect.poll(() => bodies.length).toBe(2);
  expect(bodies[1].message).toBe("Typed follow-up");
  expect(JSON.stringify(bodies[1].patch)).toContain("Newer manual edit");
});

test("out-of-order transcription never applies an answer to a changed prompt", async ({
  page,
}) => {
  await mockVoice(page);
  await openIntakeForm(page);
  await start(page);
  await page.evaluate(() => {
    window.__voice.emit({
      type: "input_audio_buffer.committed",
      item_id: "A",
      previous_item_id: null,
    });
    window.__voice.emit({
      type: "input_audio_buffer.committed",
      item_id: "B",
      previous_item_id: "A",
    });
    window.__voice.emit({
      type: "conversation.item.input_audio_transcription.completed",
      item_id: "B",
      content_index: 0,
      transcript: "Heights",
    });
  });
  await expect(profileConcept(page)).toHaveValue("");
  await page.evaluate(() =>
    window.__voice.emit({
      type: "conversation.item.input_audio_transcription.completed",
      item_id: "A",
      content_index: 0,
      transcript: "Coffee",
    }),
  );
  await expect(profileConcept(page)).toHaveValue("Coffee");
  await page.evaluate(() => window.__voice.finishReply());
  await expect(
    page.getByLabel("Areas to favor or avoid", { exact: true }),
  ).toHaveValue("");
  await expect(voice(page).getByRole("status")).toContainText("Please repeat");
});

test("responsive reduced-motion and WebGL fallback keep accessible voice controls and survive navigation", async ({
  page,
}, testInfo) => {
  await mockVoice(page, { noWebGL: true });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openIntakeForm(page);
  await start(page);
  for (const width of [375, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(voice(page).locator("canvas")).toHaveCount(0);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
    const { violations } = await new AxeBuilder({ page })
      .include('section[aria-label="Voice assistant"]')
      .analyze();
    expect(violations).toEqual([]);
  }
  if (testInfo.project.name === "chromium")
    await page.screenshot({
      path: "/tmp/hac111-voice-desktop.png",
      fullPage: true,
    });
  await page
    .getByRole("navigation", { name: "Project views", exact: true })
    .getByRole("link", { name: "Map", exact: true })
    .click();
  // HAC-143: the session belongs to the consultant shell, so navigation keeps it running.
  await expect(page).toHaveURL(/\/map/);
  await expect(voice(page)).toHaveCount(1);
  await expect(voice(page).getByRole("status")).toContainText("Listening");
  expect(await page.evaluate(() => window.__voice.stopped)).toBe(0);
  expect(await page.evaluate(() => window.__voice.peersClosed)).toBe(0);
  await voice(page)
    .getByRole("button", { name: "Stop voice", exact: true })
    .click();
  expect(await page.evaluate(() => window.__voice.stopped)).toBe(1);
  expect(await page.evaluate(() => window.__voice.peersClosed)).toBe(1);
});

test("a manual edit between speech capture and transcription cannot move the answer into another field", async ({
  page,
}) => {
  await mockVoice(page);
  await openIntakeForm(page);
  await start(page);
  await page.evaluate(() => {
    window.__voice.emit({
      type: "input_audio_buffer.speech_started",
      item_id: "A",
    });
    window.__voice.emit({
      type: "input_audio_buffer.committed",
      item_id: "A",
      previous_item_id: null,
    });
  });
  await profileConcept(page).fill("Typed espresso");
  await page.evaluate(() =>
    window.__voice.emit({
      type: "conversation.item.input_audio_transcription.completed",
      item_id: "A",
      content_index: 0,
      transcript: "Spoken coffee",
    }),
  );
  await expect(voice(page).getByRole("status")).toContainText("Please repeat");
  await expect(profileConcept(page)).toHaveValue("Typed espresso");
  await expect(
    page.getByLabel("Areas to favor or avoid", { exact: true }),
  ).toHaveValue("");
  await expect(
    page
      .getByRole("list", { name: "Conversation", exact: true })
      .getByText("Spoken coffee", { exact: true }),
  ).toHaveCount(0);
});

test("pending microphone access disables mute and speech, while cancel disposes a late stream", async ({
  page,
}) => {
  const setups = await mockVoice(page, { pendingMic: true });
  await openIntakeForm(page);
  await voice(page)
    .getByRole("button", { name: "Start voice", exact: true })
    .click();
  await expect(voice(page).getByRole("status")).toContainText(
    "Waiting for microphone access",
  );
  await expect(
    voice(page).getByRole("button", { name: "Mute microphone", exact: true }),
  ).toBeDisabled();
  await expect(
    voice(page).getByRole("button", { name: "Stop speaking", exact: true }),
  ).toBeDisabled();
  await expect(
    voice(page).getByRole("button", { name: "Stop voice", exact: true }),
  ).toBeEnabled();
  expect(setups()).toBe(0);
  await voice(page)
    .getByRole("button", { name: "Stop voice", exact: true })
    .click();
  await page.evaluate(() => window.__voice.releaseMicrophone());
  await expect.poll(() => page.evaluate(() => window.__voice.stopped)).toBe(1);
  expect(setups()).toBe(0);
  await expect(
    voice(page).getByRole("button", { name: "Start voice", exact: true }),
  ).toBeEnabled();
});

test("a live microphone supports mute during connection, speech waits for readiness, and disconnect clears controls", async ({
  page,
}) => {
  await mockVoice(page);
  let setup!: import("@playwright/test").Route;
  await page.route("**/api/voice/session", async (route) => {
    if (route.request().method() === "GET") return route.fallback();
    setup = route;
  });
  await openIntakeForm(page);
  await voice(page)
    .getByRole("button", { name: "Start voice", exact: true })
    .click();
  await expect(voice(page).getByRole("status")).toContainText(
    "Connecting voice",
  );
  await expect(
    voice(page).getByRole("button", { name: "Mute microphone", exact: true }),
  ).toBeEnabled();
  await expect(
    voice(page).getByRole("button", { name: "Stop speaking", exact: true }),
  ).toBeDisabled();
  await expect.poll(() => Boolean(setup)).toBe(true);
  await setup.fulfill({
    json: { answerSdp: "v=0\r\nmock-answer", sessionSeconds: 180 },
  });
  await expect(voice(page).getByRole("status")).toContainText("Listening");
  await expect(
    voice(page).getByRole("button", { name: "Stop speaking", exact: true }),
  ).toBeEnabled();
  await page.evaluate(() => window.__voice.disconnectPeer());
  await expect(voice(page).getByRole("status")).toContainText(
    "Voice disconnected",
  );
  await expect(
    voice(page).getByRole("button", { name: "Mute microphone", exact: true }),
  ).toHaveCount(0);
  await expect(
    voice(page).getByRole("button", { name: "Stop speaking", exact: true }),
  ).toHaveCount(0);
  expect(await page.evaluate(() => window.__voice.stopped)).toBe(1);
});

for (const [failureName, message] of [
  ["NotAllowedError", "Microphone permission was denied"],
  ["NotFoundError", "No microphone was found"],
  ["NotReadableError", "microphone could not be opened"],
  ["NotSupportedError", "Microphone access is not supported"],
]) {
  test(`${failureName} gives specific recovery guidance and Text is one click away with its draft`, async ({
    page,
  }) => {
    const setups = await mockVoice(page, {
      failureName,
      unsupported: failureName === "NotSupportedError",
    });
    await openIntakeForm(page);
    const assistant = page.getByRole("complementary", {
      name: "Assistant",
      exact: true,
    });
    await assistant.getByRole("tab", { name: "Text", exact: true }).click();
    await page
      .getByRole("textbox", { name: "Message the BizBox assistant" })
      .fill("Keep my draft");
    await assistant.getByRole("tab", { name: "Voice", exact: true }).click();
    await voice(page)
      .getByRole("button", { name: "Start voice", exact: true })
      .click();
    const status = voice(page).getByRole("status");
    await expect(status).toContainText(message);
    await expect(status).toContainText("Text");
    if (failureName === "NotAllowedError")
      await expect(status).toContainText("site settings");
    if (failureName === "NotFoundError")
      await expect(status).toContainText("Connect or select");
    await expect(status).not.toContainText("Private device details");
    expect(setups()).toBe(0);
    await assistant.getByRole("tab", { name: "Text", exact: true }).click();
    await expect(
      page.getByRole("textbox", { name: "Message the BizBox assistant" }),
    ).toHaveValue("Keep my draft");
  });
}

test("losing the live microphone stops owned resources and offers retry", async ({
  page,
}) => {
  await mockVoice(page);
  await openIntakeForm(page);
  await start(page);
  await page.evaluate(() => window.__voice.disconnectMicrophone());
  await expect(voice(page).getByRole("status")).toContainText(
    "microphone disconnected",
  );
  await expect(
    voice(page).getByRole("button", { name: "Start voice", exact: true }),
  ).toBeEnabled();
  expect(await page.evaluate(() => window.__voice.stopped)).toBe(1);
  expect(await page.evaluate(() => window.__voice.peersClosed)).toBe(1);
});
