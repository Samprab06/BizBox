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
  const track = {
    enabled: true,
    stopped: false,
    stop() {
      this.stopped = true;
    },
  };
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
