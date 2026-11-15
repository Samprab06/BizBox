import { afterEach, describe, expect, it, vi } from "vitest";
import { VoiceClient, type VoiceDependencies } from "./client";
import type { VoiceAdapter } from "./contracts";

const completed = (id: string, transcript: string) =>
  JSON.stringify({
    type: "conversation.item.input_audio_transcription.completed",
    item_id: id,
    content_index: 0,
    transcript,
  });
const flush = async () => {
  for (let i = 0; i < 12; i++) await Promise.resolve();
};
function fixture(adapter?: Partial<VoiceAdapter>) {
  class FakeTrack extends EventTarget {
    enabled = true;
    stopped = false;
    readyState: MediaStreamTrackState = "live";
    stop() {
      this.stopped = true;
      this.readyState = "ended";
    }
  }
  const track = new FakeTrack();
  const stream = {
    getTracks: () => [track],
    getAudioTracks: () => [track],
  } as unknown as MediaStream;
  const channel = {
    readyState: "open",
    onopen: null,
    onclose: null,
    onerror: null,
    onmessage: null,
    sent: [] as Record<string, unknown>[],
    closed: false,
    send(text: string) {
      this.sent.push(JSON.parse(text));
    },
    close() {
      this.closed = true;
    },
  };
  const peer = {
    connectionState: "connected",
    ontrack: null,
    onconnectionstatechange: null,
    closed: false,
    createDataChannel: () => channel,
    addTrack: () => {},
    createOffer: async () => ({ type: "offer", sdp: "v=0\r\nmock-offer" }),
    setLocalDescription: async () => {},
    setRemoteDescription: async () => {},
    close() {
      this.closed = true;
    },
  };
  const audio = {
    muted: true,
    autoplay: false,
    srcObject: null,
    paused: false,
    removed: false,
    play: async () => {},
    pause() {
      this.paused = true;
    },
    remove() {
      this.removed = true;
    },
  };
  let analyzing = false;
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValue(
      Response.json({ answerSdp: "v=0\r\nmock-answer", sessionSeconds: 180 }),
    );
  const submit = vi.fn(async (text: string) => `Reply to ${text}`);
  const client = new VoiceClient(
    {
      readContext: () => ({ projectId: "houston-coffee", mode: "intake" }),
      submitTranscript: submit,
      ...adapter,
    },
    {
      getUserMedia: async () => stream,
      createPeer: () => peer as unknown as RTCPeerConnection,
      createAudio: () => audio as unknown as HTMLAudioElement,
      fetcher,
      analyze: () => {
        analyzing = true;
        return () => {
          analyzing = false;
        };
      },
      setTimer: (callback, ms) => setTimeout(callback, ms),
      clearTimer: (timer) => clearTimeout(timer),
    } satisfies VoiceDependencies,
  );
  const event = (data: string) =>
    (channel.onmessage as unknown as (event: { data: string }) => void)?.({
      data,
    });
  let previous: string | null = null;
  const complete = (id: string, text: string) => {
    event(
      JSON.stringify({
        type: "input_audio_buffer.committed",
        item_id: id,
        previous_item_id: previous,
      }),
    );
    previous = id;
    event(completed(id, text));
  };
  const finishSpeech = () => {
    const request = channel.sent.findLast(
      (e) => e.type === "response.create",
    ) as { response: { metadata: { voice_turn: string } } };
    event(
      JSON.stringify({
        type: "response.created",
        response: { id: "response1", metadata: request.response.metadata },
      }),
    );
    event(
      JSON.stringify({
        type: "output_audio_buffer.stopped",
        response_id: "response1",
      }),
    );
  };
  return {
    client,
    track,
    peer,
    channel,
    audio,
    fetcher,
    submit,
    event,
    finishSpeech,
    complete,
    analyzing: () => analyzing,
  };
}

afterEach(() => {
  vi.useRealTimers();
});
describe("VoiceClient", () => {
  it("does no microphone or paid setup work before explicit start", () => {
    const f = fixture();
    expect(f.client.snapshot.phase).toBe("idle");
    expect(f.fetcher).not.toHaveBeenCalled();
    expect(f.analyzing()).toBe(false);
  });
  it("submits a completed transcript once and requests only the actual action reply out of band", async () => {
    const f = fixture();
    await f.client.start();
    f.complete("one", "Coffee");
    f.complete("one", "Coffee");
    await flush();
    expect(f.submit).toHaveBeenCalledExactlyOnceWith("Coffee");
    const request = f.channel.sent.find(
      (e) => e.type === "response.create",
    ) as { response: Record<string, unknown> };
    expect(request.response).toMatchObject({
      conversation: "none",
      input: [],
      output_modalities: ["audio"],
      max_output_tokens: 512,
    });
    expect(request.response.instructions).toContain('"Reply to Coffee"');
    expect(f.audio.muted).toBe(true);
    f.finishSpeech();
    await flush();
    expect(f.client.snapshot.phase).toBe("listening");
    f.client.stop();
  });
  it("serializes existing business actions and suppresses an interrupted older reply", async () => {
    let resolve!: (reply: string) => void;
    const submit = vi.fn((text: string) =>
      text === "first"
        ? new Promise<string>((r) => {
            resolve = r;
          })
        : Promise.resolve("second reply"),
    );
    const f = fixture({ submitTranscript: submit });
    await f.client.start();
    f.complete("1", "first");
    await flush();
    f.complete("2", "second");
    await flush();
    expect(submit).toHaveBeenCalledTimes(1);
    resolve("old reply");
    await flush();
    expect(submit.mock.calls.map((call) => call[0])).toEqual([
      "first",
      "second",
    ]);
    const requests = f.channel.sent.filter((e) => e.type === "response.create");
    expect(requests).toHaveLength(1);
    expect(JSON.stringify(requests)).toContain("second reply");
    expect(JSON.stringify(requests)).not.toContain("old reply");
    f.client.stop();
  });
  it("stop closes all owned resources and rejects late action/audio callbacks", async () => {
    let resolve!: (reply: string) => void;
    const f = fixture({
      submitTranscript: () =>
        new Promise<string>((r) => {
          resolve = r;
        }),
    });
    await f.client.start();
    f.complete("one", "Coffee");
    await flush();
    const late = f.channel.onmessage;
    f.client.stop();
    resolve("too late");
    await flush();
    expect(f.track.stopped).toBe(true);
    expect(f.peer.closed).toBe(true);
    expect(f.channel.closed).toBe(true);
    expect(f.audio.paused).toBe(true);
    expect(f.audio.srcObject).toBeNull();
    expect(f.analyzing()).toBe(false);
    (late as unknown as (event: { data: string }) => void)({
      data: completed("two", "late input"),
    });
    await flush();
    expect(f.client.snapshot.phase).toBe("idle");
    expect(
      f.channel.sent.filter((e) => e.type === "response.create"),
    ).toHaveLength(0);
  });
  it("mute disables input and ignores buffered transcripts without abandoning text", async () => {
    const f = fixture();
    await f.client.start();
    f.client.setMuted(true);
    expect(f.track.enabled).toBe(false);
    expect(f.client.snapshot.muted).toBe(true);
    f.complete("one", "muted");
    await flush();
    expect(f.submit).not.toHaveBeenCalled();
    f.client.setMuted(false);
    expect(f.track.enabled).toBe(true);
    f.complete("two", "unmuted");
    await flush();
    expect(f.submit).toHaveBeenCalledWith("unmuted");
    f.client.stop();
  });
  it("clears pending speech on interruption without submitting a business action", async () => {
    const f = fixture();
    await f.client.start();
    f.complete("one", "Coffee");
    await flush();
    const request = f.channel.sent.find(
      (e) => e.type === "response.create",
    ) as { response: { metadata: { voice_turn: string } } };
    f.event(
      JSON.stringify({
        type: "response.created",
        response: { id: "speaking", metadata: request.response.metadata },
      }),
    );
    f.client.interrupt();
    await flush();
    expect(f.channel.sent.map((e) => e.type)).toContain("response.cancel");
    expect(f.channel.sent.map((e) => e.type)).toContain(
      "output_audio_buffer.clear",
    );
    expect(f.submit).toHaveBeenCalledTimes(1);
    expect(f.audio.muted).toBe(true);
    f.client.stop();
  });
  it("does not permit unsolicited generated audio", async () => {
    const f = fixture();
    await f.client.start();
    f.event(
      JSON.stringify({
        type: "response.created",
        response: { id: "unexpected", metadata: {} },
      }),
    );
    expect(f.audio.muted).toBe(true);
    expect(f.channel.sent).toContainEqual(
      expect.objectContaining({
        type: "response.cancel",
        response_id: "unexpected",
      }),
    );
    f.client.stop();
  });
  it("ignores malformed and oversized events; null/oversized replies are not spoken", async () => {
    const f = fixture({ submitTranscript: async () => null });
    await f.client.start();
    for (const event of [
      "{",
      JSON.stringify({
        type: "conversation.item.input_audio_transcription.completed",
        transcript: "missing id",
      }),
      completed("big", "x".repeat(2001)),
      completed("empty", " "),
    ])
      f.event(event);
    expect(f.channel.sent).toEqual([]);
    f.complete("valid", "hello");
    await flush();
    expect(
      f.channel.sent.filter((e) => e.type === "response.create"),
    ).toHaveLength(0);
    f.client.stop();
  });
  it("bounds dedup/queued input rather than accumulating unbounded work", async () => {
    const f = fixture({ submitTranscript: () => new Promise(() => {}) });
    await f.client.start();
    for (let i = 0; i < 20; i++) f.complete(String(i), "hello");
    await flush();
    expect(f.client.snapshot.phase).toBe("error");
    expect(f.track.stopped).toBe(true);
  });
  it("ends the microphone session after the server's bounded duration", async () => {
    vi.useFakeTimers();
    const f = fixture();
    await f.client.start();
    await vi.advanceTimersByTimeAsync(180_001);
    expect(f.track.stopped).toBe(true);
    expect(f.peer.closed).toBe(true);
    expect(f.client.snapshot.phase).toBe("idle");
  });
  it("stops a microphone acquired after cancellation before any setup request", async () => {
    const f = fixture();
    let resolve!: (stream: MediaStream) => void;
    const deps = f.client.dependencies;
    deps.getUserMedia = () =>
      new Promise<MediaStream>((r) => {
        resolve = r;
      });
    const start = f.client.start();
    f.client.stop();
    const track = { stop: vi.fn() };
    resolve({ getTracks: () => [track] } as unknown as MediaStream);
    await start;
    expect(track.stop).toHaveBeenCalledTimes(1);
    expect(f.fetcher).not.toHaveBeenCalled();
  });
  it("reports permission denial generically and can retry", async () => {
    const f = fixture();
    const original = f.client.dependencies.getUserMedia;
    f.client.dependencies.getUserMedia = async () => {
      throw new DOMException("private device info", "NotAllowedError");
    };
    await f.client.start();
    expect(f.client.snapshot.phase).toBe("error");
    expect(f.client.snapshot.message).not.toContain("private device info");
    expect(f.fetcher).not.toHaveBeenCalled();
    f.client.dependencies.getUserMedia = original;
    await f.client.start();
    expect(f.client.snapshot.phase).toBe("listening");
    f.client.stop();
  });
});

describe("ordered transcription and out-of-band cancellation", () => {
  it("submits committed A then B even when completed B arrives first", async () => {
    const submit = vi.fn(async () => null);
    const f = fixture({ submitTranscript: submit });
    await f.client.start();
    f.event(
      JSON.stringify({
        type: "input_audio_buffer.committed",
        item_id: "A",
        previous_item_id: null,
      }),
    );
    f.event(
      JSON.stringify({
        type: "input_audio_buffer.committed",
        item_id: "B",
        previous_item_id: "A",
      }),
    );
    f.event(completed("B", "second answer"));
    await flush();
    expect(submit).not.toHaveBeenCalled();
    f.event(completed("A", "first answer"));
    await flush();
    expect(submit.mock.calls).toEqual([["first answer"], ["second answer"]]);
    f.client.stop();
  });
  it("ignores a completion with no committed microphone item", async () => {
    const f = fixture();
    await f.client.start();
    f.event(completed("unknown", "unexpected"));
    await flush();
    expect(f.submit).not.toHaveBeenCalled();
    f.client.stop();
  });
  it("cancels the actual out-of-band response and tolerates only its correlated completed-response race", async () => {
    const f = fixture();
    await f.client.start();
    f.event(
      JSON.stringify({
        type: "input_audio_buffer.committed",
        item_id: "A",
        previous_item_id: null,
      }),
    );
    f.event(completed("A", "hello"));
    await flush();
    const request = f.channel.sent.find(
      (e) => e.type === "response.create",
    ) as { response: { metadata: { voice_turn: string } } };
    f.event(
      JSON.stringify({
        type: "response.created",
        response: { id: "outofband", metadata: request.response.metadata },
      }),
    );
    f.client.interrupt();
    const cancel = f.channel.sent.find((e) => e.type === "response.cancel");
    expect(cancel).toMatchObject({
      type: "response.cancel",
      response_id: "outofband",
      event_id: expect.any(String),
    });
    f.event(
      JSON.stringify({
        type: "error",
        error: {
          code: "response_cancel_not_active",
          event_id: cancel!.event_id,
        },
      }),
    );
    expect(f.track.stopped).toBe(false);
    f.event(
      JSON.stringify({
        type: "error",
        error: { code: "response_cancel_not_active", event_id: "unrelated" },
      }),
    );
    expect(f.track.stopped).toBe(true);
  });
  it("defers cancellation until a pending response ID exists and never unmutes stale output", async () => {
    const f = fixture();
    await f.client.start();
    f.event(
      JSON.stringify({
        type: "input_audio_buffer.committed",
        item_id: "A",
        previous_item_id: null,
      }),
    );
    f.event(completed("A", "hello"));
    await flush();
    const request = f.channel.sent.find(
      (e) => e.type === "response.create",
    ) as { response: { metadata: { voice_turn: string } } };
    f.client.interrupt();
    expect(
      f.channel.sent.filter((e) => e.type === "response.cancel"),
    ).toHaveLength(0);
    f.event(
      JSON.stringify({
        type: "response.created",
        response: { id: "arrived-late", metadata: request.response.metadata },
      }),
    );
    expect(f.channel.sent).toContainEqual(
      expect.objectContaining({
        type: "response.cancel",
        response_id: "arrived-late",
      }),
    );
    expect(f.audio.muted).toBe(true);
    f.client.stop();
  });
});

describe("capture intent stays bound to its original context", () => {
  it("discards an item committed while muted even if transcription arrives after unmute", async () => {
    const f = fixture();
    await f.client.start();
    f.client.setMuted(true);
    f.event(
      JSON.stringify({
        type: "input_audio_buffer.committed",
        item_id: "muted",
        previous_item_id: null,
      }),
    );
    f.client.setMuted(false);
    f.event(completed("muted", "buffered words"));
    await flush();
    expect(f.submit).not.toHaveBeenCalled();
    f.client.stop();
  });
  it("does not apply an utterance to a different prompt after a manual context change", async () => {
    let prompt = "Business concept";
    const f = fixture({
      readContext: () => ({
        projectId: "houston-coffee",
        mode: "intake",
        prompt,
      }),
    });
    await f.client.start();
    f.event(
      JSON.stringify({
        type: "input_audio_buffer.speech_started",
        item_id: "A",
      }),
    );
    prompt = "Areas to favor or avoid";
    f.event(
      JSON.stringify({
        type: "input_audio_buffer.committed",
        item_id: "A",
        previous_item_id: null,
      }),
    );
    f.event(completed("A", "Spoken coffee"));
    await flush();
    expect(f.submit).not.toHaveBeenCalled();
    expect(f.client.snapshot.message).toMatch(/repeat|typing/i);
    f.client.stop();
  });
});

it("HAC-149 fingerprints comparison changes during an utterance", async () => {
  let comparisonId = "first";
  const f = fixture({
    readContext: () => ({
      projectId: "houston-coffee",
      mode: "chat",
      view: { stage: "comparison", comparisonId },
    }),
  });
  await f.client.start();
  f.event(
    JSON.stringify({ type: "input_audio_buffer.speech_started", item_id: "A" }),
  );
  comparisonId = "second";
  f.event(
    JSON.stringify({
      type: "input_audio_buffer.committed",
      item_id: "A",
      previous_item_id: null,
    }),
  );
  f.event(completed("A", "Compare this one"));
  await flush();
  expect(f.submit).not.toHaveBeenCalled();
  f.client.stop();
});

describe("microphone readiness", () => {
  it("keeps readiness false and mute a no-op while microphone permission is pending", async () => {
    const f = fixture();
    const acquire = f.client.dependencies.getUserMedia;
    let resolve!: (stream: MediaStream) => void;
    f.client.dependencies.getUserMedia = () =>
      new Promise((done) => {
        resolve = done;
      });
    const start = f.client.start();
    expect(f.client.snapshot.microphoneReady).toBe(false);
    f.client.setMuted(true);
    expect(f.client.snapshot.muted).toBe(false);
    expect(f.client.snapshot.message).not.toContain("muted");
    expect(f.fetcher).not.toHaveBeenCalled();
    f.client.stop();
    resolve(await acquire());
    await start;
    expect(f.track.stopped).toBe(true);
    expect(f.client.snapshot.microphoneReady).toBe(false);
    expect(f.fetcher).not.toHaveBeenCalled();
  });
  it("publishes live microphone evidence during setup and clears it on disconnect and stop", async () => {
    const f = fixture();
    let release!: (response: Response) => void;
    f.fetcher.mockImplementation(
      () =>
        new Promise((done) => {
          release = done;
        }),
    );
    const start = f.client.start();
    await flush();
    expect(f.client.snapshot).toMatchObject({
      phase: "connecting",
      microphoneReady: true,
    });
    f.client.setMuted(true);
    expect(f.track.enabled).toBe(false);
    release(
      Response.json({ answerSdp: "v=0\r\nmock-answer", sessionSeconds: 180 }),
    );
    await start;
    expect(f.client.snapshot).toMatchObject({
      phase: "listening",
      microphoneReady: true,
      muted: true,
    });
    f.peer.connectionState = "disconnected";
    (f.peer.onconnectionstatechange as unknown as () => void)();
    expect(f.client.snapshot).toMatchObject({
      phase: "error",
      microphoneReady: false,
    });
    expect(f.track.stopped).toBe(true);
  });
  it("rejects an empty or ended audio stream before setup and notices a lost microphone", async () => {
    const empty = fixture();
    empty.client.dependencies.getUserMedia = async () =>
      ({
        getTracks: () => [],
        getAudioTracks: () => [],
      }) as unknown as MediaStream;
    await empty.client.start();
    expect(empty.client.snapshot).toMatchObject({
      phase: "error",
      microphoneReady: false,
    });
    expect(empty.client.snapshot.message).toContain("No microphone");
    expect(empty.fetcher).not.toHaveBeenCalled();
    const ended = fixture();
    ended.track.readyState = "ended";
    await ended.client.start();
    expect(ended.client.snapshot.microphoneReady).toBe(false);
    expect(ended.fetcher).not.toHaveBeenCalled();
    const live = fixture();
    await live.client.start();
    live.track.readyState = "ended";
    live.track.dispatchEvent(new Event("ended"));
    expect(live.client.snapshot).toMatchObject({
      phase: "error",
      microphoneReady: false,
    });
    expect(live.client.snapshot.message).toContain("disconnected");
  });
  it.each([
    ["NotAllowedError", "permission was denied", "site settings"],
    ["NotFoundError", "No microphone", "Connect"],
    ["NotReadableError", "could not be opened", "another app"],
    ["NotSupportedError", "not supported", "supported browser"],
  ])(
    "classifies %s without leaking device details or starting a provider session",
    async (name, message, action) => {
      const f = fixture();
      f.client.dependencies.getUserMedia = async () => {
        throw new DOMException("private device details", name);
      };
      await f.client.start();
      expect(f.client.snapshot.microphoneReady).toBe(false);
      expect(f.client.snapshot.message).toContain(message);
      expect(f.client.snapshot.message).toContain(action);
      expect(f.client.snapshot.message).toContain("Text");
      expect(f.client.snapshot.message).not.toContain("private device details");
      expect(f.fetcher).not.toHaveBeenCalled();
    },
  );
  it("keeps a provider/setup failure distinct from microphone permission denial", async () => {
    const f = fixture();
    f.fetcher.mockResolvedValue(new Response(null, { status: 503 }));
    await f.client.start();
    expect(f.client.snapshot).toMatchObject({
      phase: "error",
      microphoneReady: false,
    });
    expect(f.client.snapshot.message).toContain("could not connect");
    expect(f.client.snapshot.message).not.toContain("permission");
    expect(f.track.stopped).toBe(true);
  });
});

describe("spoken reply delivery", () => {
  it("keeps the agent reply audible when only the microphone is muted", async () => {
    let resolve!: (text: string) => void;
    const f = fixture({
      submitTranscript: () =>
        new Promise<string>((done) => {
          resolve = done;
        }),
    });
    try {
      await f.client.start();
      f.complete("A", "Compare these locations");
      await flush();
      f.client.setMuted(true);
      resolve("Here is the comparison.");
      await flush();
      expect(
        f.channel.sent.filter((e) => e.type === "response.create"),
      ).toHaveLength(1);
      const request = f.channel.sent.find(
        (e) => e.type === "response.create",
      ) as { response: { metadata: unknown } };
      f.event(
        JSON.stringify({
          type: "response.created",
          response: { id: "audio", metadata: request.response.metadata },
        }),
      );
      expect(f.track.enabled).toBe(false);
      expect(f.audio.muted).toBe(false);
      expect(
        f.channel.sent.filter((e) => e.type === "response.cancel"),
      ).toHaveLength(0);
    } finally {
      f.client.stop();
    }
  });
  it("does not discard a pending agent reply for an unconfirmed VAD start", async () => {
    let resolve!: (text: string) => void;
    const f = fixture({
      submitTranscript: () =>
        new Promise<string>((done) => {
          resolve = done;
        }),
    });
    try {
      await f.client.start();
      f.complete("A", "What is the rent?");
      await flush();
      f.event(
        JSON.stringify({
          type: "input_audio_buffer.speech_started",
          item_id: "noise",
        }),
      );
      f.event(
        JSON.stringify({
          type: "input_audio_buffer.speech_stopped",
          item_id: "noise",
        }),
      );
      resolve("The asking rent is listed in the comparison.");
      await flush();
      expect(
        f.channel.sent.filter((e) => e.type === "response.create"),
      ).toHaveLength(1);
    } finally {
      f.client.stop();
    }
  });
  it("reports failed speech output while retaining the working conversation and microphone", async () => {
    const f = fixture();
    try {
      await f.client.start();
      f.complete("A", "Hello");
      await flush();
      const request = f.channel.sent.find(
        (e) => e.type === "response.create",
      ) as { response: { metadata: unknown } };
      f.event(
        JSON.stringify({
          type: "response.created",
          response: { id: "failed-audio", metadata: request.response.metadata },
        }),
      );
      f.event(
        JSON.stringify({
          type: "response.done",
          response: {
            id: "failed-audio",
            status: "failed",
            status_details: { error: { message: "Private provider details" } },
          },
        }),
      );
      await flush();
      expect(f.client.snapshot.message).toMatch(/audio.*failed/i);
      expect(f.client.snapshot.message).not.toContain(
        "Private provider details",
      );
      expect(f.track.stopped).toBe(false);
    } finally {
      f.client.stop();
    }
  });
  it("speaks a bounded excerpt instead of dropping a long text-agent reply", async () => {
    const reply = "The location comparison is ready. ".repeat(180);
    const f = fixture({ submitTranscript: async () => reply });
    try {
      await f.client.start();
      f.complete("A", "Explain the comparison");
      await flush();
      const requests = f.channel.sent.filter(
        (e) => e.type === "response.create",
      );
      expect(requests).toHaveLength(1);
      expect(JSON.stringify(requests[0])).not.toContain(reply);
      expect(JSON.stringify(requests[0])).toContain(
        "The location comparison is ready.",
      );
    } finally {
      f.client.stop();
    }
  });
});

it("keeps chat input when only replay time or loading phase changes", async () => {
  let minute = 10;
  let phase: "ready" | "running" = "ready";
  const f = fixture({
    readContext: () => ({
      projectId: "houston-coffee",
      mode: "chat",
      view: {
        stage: "replay",
        siteId: "site-a",
        comparisonId: "same",
        minute,
        phase,
      },
    }),
  });
  try {
    await f.client.start();
    f.event(
      JSON.stringify({
        type: "input_audio_buffer.speech_started",
        item_id: "A",
      }),
    );
    minute = 11;
    phase = "running";
    f.complete("A", "What causes this queue?");
    await flush();
    expect(f.submit).toHaveBeenCalledExactlyOnceWith("What causes this queue?");
  } finally {
    f.client.stop();
  }
});

it("does not cancel pending speech output for an unconfirmed VAD start", async () => {
  const f = fixture();
  try {
    await f.client.start();
    f.complete("A", "Hello");
    await flush();
    const request = f.channel.sent.find(
      (e) => e.type === "response.create",
    ) as { response: { metadata: unknown } };
    f.event(
      JSON.stringify({
        type: "input_audio_buffer.speech_started",
        item_id: "noise",
      }),
    );
    f.event(
      JSON.stringify({
        type: "input_audio_buffer.speech_stopped",
        item_id: "noise",
      }),
    );
    f.event(
      JSON.stringify({
        type: "response.created",
        response: { id: "reply", metadata: request.response.metadata },
      }),
    );
    expect(
      f.channel.sent.filter((e) => e.type === "response.cancel"),
    ).toHaveLength(0);
    expect(f.audio.muted).toBe(false);
  } finally {
    f.client.stop();
  }
});
