import { createVoiceOrb } from "./orb.js";

const $ = (selector) => document.querySelector(selector);
const sites = {
  A: {
    name: "Space A",
    area: "Silver Lake",
    rent: 4500,
    size: "Size not verified",
  },
  B: {
    name: "Space B",
    area: "Echo Park",
    rent: 4800,
    size: "Size not verified",
  },
  C: {
    name: "Space C",
    area: "Culver City",
    rent: 4200,
    size: "No matched interior",
  },
};
const checkpoints = [
  "Explore",
  "Space",
  "Interior",
  "Experiment",
  "Replay",
  "Compare",
  "Keep",
];
// Hand-authored UI fixtures, never a model/forecast. Same example demand across alternatives.
const fixtures = {
  1: { served: 22, wait: 12, left: 16 },
  2: { served: 32, wait: 7, left: 6 },
  3: { served: 36, wait: 4, left: 2 },
  4: { served: 36, wait: 4, left: 2 },
  5: { served: 36, wait: 4, left: 2 },
};
const initial = {
  stage: 0,
  site: "A",
  view: "city",
  mode: "text",
  draft: "",
  stations: 3,
  kept: false,
  baselineDone: false,
  scenario: "baseline",
  minute: 0,
  playing: false,
  speed: 1,
  voicePhase: "idle",
  muted: false,
  messages: [],
};
const state = { ...initial };
const keptPlans = new Map();
let scene = { update() {}, zoom() {}, reset() {}, mode: "loading" },
  frame = 0,
  lastTick = 0,
  voiceTimer = 0,
  voiceEndTimer = 0,
  customerSelected = false;
const orb = createVoiceOrb($("#voice-orb"));
const money = (n) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
const esc = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const clock = (minute) =>
  `${String(8 + Math.floor(minute / 60)).padStart(2, "0")}:${String(Math.floor(minute) % 60).padStart(2, "0")}`;
function announce(text) {
  $("#announcement").textContent = text;
}
function evidence(label) {
  return `<div class="evidence-row"><span class="evidence-dot"></span>${label}</div>`;
}
function button(action, text, kind = "action-chip") {
  return `<button class="${kind}" data-action="${action}">${text}</button>`;
}
function message(text, user = false, card = "") {
  return `<article class="message ${user ? "user" : "assistant"}"><span class="avatar" aria-hidden="true">${user ? "○" : "✧"}</span><div class="message-body"><div class="message-label">${user ? "You" : "Consultant"}<time>Now</time></div><p>${esc(text)}</p>${card}</div></article>`;
}
function fixture(stations = state.stations) {
  return fixtures[stations];
}
const seenMessages = new Set();
function stageConversation() {
  const site = sites[state.site];
  if (!state.messages.length) {
    state.messages.push({
      text: "I found three spaces that fit your brief.",
      user: false,
      card: `<div class="inline-card"><span class="eyebrow">A PLACE TO START</span><h3>${site.name} · ${site.area}</h3><div class="card-price">${money(site.rent)}<span class="muted" style="font-size:11px;font-weight:400"> / month</span></div>${evidence("Within your rent target")}${evidence("Demand still needs testing")}</div>`,
    });
  }
  const key = `${state.site}:${state.stage}:${state.stage >= 3 ? state.stations : 2}`;
  if (!seenMessages.has(key)) {
    seenMessages.add(key);
    const add = (text, user = false, card = "") =>
      state.messages.push({ text, user, card });
    if (state.stage === 1) {
      add("Tell me about " + site.name + ".", true);
      add(
        "It fits your rent target. We can compare locations or test your service setup here.",
        false,
        `<div class="inline-card">${evidence("Rent · Example listing")}${evidence("Demand · Modeled example")}</div>`,
      );
    }
    if (state.stage === 2) {
      add("Show me the interior of " + site.name + ".", true);
      add(
        state.site === "C"
          ? "There isn’t a matched scan for this example. You can still test operations in a clearly modeled layout."
          : "This modeled layout shows the entrance, queue, and service stations. Start with a baseline before changing anything.",
      );
    }
    if (state.stage === 3) {
      add("What if I add a service station at " + site.name + "?", true);
      add(
        "We’ll change the number of stations and keep demand, staff, and price the same. Your baseline stays available.",
      );
    }
    if (state.stage === 4)
      add(
        "The replay for " +
          site.name +
          " shows example customer events at the selected minute. Pause or scrub to inspect the queue.",
      );
    if (state.stage === 5) {
      const f = fixture();
      add(
        `At ${site.name}, this example with ${state.stations} stations serves ${f.served} customers with an average wait of ${f.wait} minutes. Compare both runs before deciding.`,
      );
    }
    if (state.stage === 6) {
      add("Keep the alternative for " + site.name + ".", true);
      add(
        "Saved as your current example plan for " + site.name + ".",
        false,
        `<div class="inline-card"><span class="eyebrow">CURRENT PLAN</span><h3>Alternative 1</h3><p>${state.stations} service stations · 3 staff · $6/order</p></div>`,
      );
    }
  }
  return state.messages
    .map((m) => message(m.text, m.user, m.card || ""))
    .join("");
}

function updateScene() {
  scene.update({
    view: state.view,
    site: state.site,
    stations:
      state.scenario === "baseline" && !state.kept && state.stage !== 3
        ? 2
        : state.stations,
    minute: state.minute,
    playing: state.playing,
    stage: state.stage,
  });
}
function actions() {
  if (state.stage === 0)
    return (
      button("select", "Explore Space A", "action-chip accent") +
      button("compare-sites", "Compare locations")
    );
  if (state.stage === 1)
    return (
      button("interior", "Open interior", "action-chip accent") +
      button("baseline", "Run baseline")
    );
  if (state.stage === 2)
    return state.baselineDone
      ? button("experiment", "Try an experiment", "action-chip accent")
      : button("baseline", "Run baseline", "action-chip accent");
  if (state.stage === 3)
    return button("run", "Run alternative", "action-chip accent");
  if (state.stage === 4)
    return (
      button("queue", "Highlight queue") +
      button("customer", "Inspect customer")
    );
  if (state.stage === 5) return "";
  return (
    button("another-location", "Try another location") +
    button("experiment", "Adjust setup") +
    button("compare", "View comparison")
  );
}
function details() {
  const s = sites[state.site];
  return `<div class="detail-card glass"><div class="detail-top"><div><span class="eyebrow">YOUR SELECTED SPACE</span><h3>${s.name}</h3><p class="space-address">${s.area} · Los Angeles</p></div><button class="close-detail" data-action="explore" aria-label="Close location details">×</button></div><div class="detail-rent">${money(s.rent)}<span> / month</span></div><div class="detail-facts"><div><strong>${state.kept ? state.stations : 2} stations</strong>${state.kept ? "Current plan" : "Baseline setup"}</div><div><strong>3 staff</strong>On shift</div><div><strong>${s.size}</strong>Example listing</div></div><div class="button-row">${button("interior", "Open interior", "primary")}${button("baseline", "Run baseline", "secondary")}</div></div>`;
}
function shortlist() {
  return `<div class="shortlist glass">${Object.entries(sites)
    .map(
      ([id, s]) =>
        `<button class="location-card" data-site="${id}" aria-pressed="${id === state.site}"><span class="space-letter">${id}</span><span><h3>${s.name}</h3><p class="rent">${money(s.rent)}/mo</p><p class="neighborhood">${s.area}</p></span></button>`,
    )
    .join("")}</div>`;
}
function interiorCard() {
  return `<div class="selected-strip glass"><div class="grow"><span class="eyebrow">MODELED LAYOUT</span><h3>${sites[state.site].name} · ${state.kept ? "Current plan" : state.baselineDone ? "Baseline complete" : "Ready to test"}</h3><p>${state.kept ? state.stations : 2} stations · 3 staff · $6/order</p></div>${state.baselineDone ? button("experiment", "Try an experiment", "primary") : button("baseline", "Run baseline", "primary")}</div>`;
}
function experiment() {
  return `<section class="experiment-tray glass" aria-label="Experiment setup"><div class="tray-heading"><h3>Alternative</h3><span class="subtle-pill">Baseline preserved</span></div><div class="lever"><label for="stations">Service stations</label><output id="stations-value" for="stations">2 → ${state.stations}</output><input id="stations" type="range" min="1" max="5" step="1" value="${state.stations}" aria-valuetext="${state.stations} service stations"></div><div class="lever"><label>Staff</label><output>3</output><span class="fixed-value">Unchanged</span></div><div class="lever"><label>Average order</label><output>$6</output><span class="fixed-value">Unchanged</span></div><div class="tray-footer"><p>Example fixture · added station cost not included</p><div class="button-row">${button("cancel-experiment", "Cancel", "ghost")}${button("run", "Run alternative", "primary")}</div></div></section>`;
}
function metrics() {
  const ratio = state.minute / 60,
    f = state.scenario === "baseline" ? fixtures[2] : fixture();
  return `<div class="metrics" aria-label="Example replay metrics"><span class="metric-time">At ${clock(state.minute)}</span><span class="metric glass">Served <strong>${Math.floor(f.served * ratio)}</strong></span><span class="metric glass">Waiting <strong>${state.minute === 0 ? 0 : state.minute === 60 ? 2 : Math.min(5, 1 + Math.floor((state.minute % 17) / 5))}</strong></span><span class="metric glass">Left <strong>${Math.floor(f.left * ratio)}</strong></span></div>`;
}
function comparison() {
  const f = fixture();
  return `<section class="comparison-card glass" aria-label="Example run comparison"><h3>Morning peak <span class="muted">· 08:00–09:00</span></h3><table><caption class="sr-only">Example baseline and alternative results</caption><thead><tr><th scope="col"></th><th scope="col">Baseline</th><th scope="col">Alternative</th></tr></thead><tbody><tr><td>Served</td><td>32</td><td>${f.served}</td></tr><tr><td>Average wait</td><td>7 min</td><td>${f.wait} min</td></tr><tr><td>Left</td><td>6</td><td>${f.left}</td></tr></tbody></table><p>Same example demand · Illustrative results</p></section>`;
}
function saved() {
  return `<div class="selected-strip glass"><div class="grow"><span class="saved-badge">Alternative saved</span><h3>${sites[state.site].name} · Current plan</h3><p>${state.stations} stations · 3 staff · $6/order</p></div>${button("interior", "Open interior", "primary")}${button("compare", "Compare", "secondary")}</div>`;
}
function renderDecision() {
  const el = $("#decision-card");
  el.hidden = state.stage !== 5;
  if (el.hidden) return;
  const f = fixture();
  el.innerHTML = `<h3>2 → ${state.stations} service stations</h3><div class="decision-diff"><span>${f.served - 32 >= 0 ? "+" : ""}${f.served - 32} served</span><strong>${f.wait < 7 ? `${7 - f.wait} min less waiting` : f.wait > 7 ? `${f.wait - 7} min more waiting` : "Same wait"}</strong></div><p>Example results. Added station cost not included.</p><div class="button-row">${button("keep", "Keep alternative", "primary")}${button("revert", "Revert", "secondary")}</div>`;
}
function render() {
  const visual = $(".visual-panel"),
    playback = [4, 5].includes(state.stage);
  document.body.dataset.stage = state.stage;
  document.body.dataset.mode = state.mode;
  $("#playback").hidden = !playback;
  visual.classList.toggle("has-playback", playback);
  $("#visual-content").innerHTML = [
    shortlist,
    details,
    interiorCard,
    experiment,
    metrics,
    comparison,
    saved,
  ][state.stage]();
  $("#scene-footnote").textContent =
    state.view === "city"
      ? "Illustrative 3D neighborhood · Vexcel integration pending"
      : "Modeled layout · Matterport integration pending";
  $("#scene-heading").innerHTML =
    state.view === "interior"
      ? `<span class="eyebrow">${esc(sites[state.site].name)} · ${state.site === "C" ? "NO MATCHED SCAN" : "EXAMPLE INTERIOR"}</span><h2>See how your space works.</h2><p>Entrance, queue, and service stations</p>`
      : state.stage === 0
        ? '<span class="eyebrow">LOS ANGELES</span><h2>Find your place.</h2><p>Three spaces. One business idea.</p>'
        : "";
  document
    .querySelectorAll("[data-view]")
    .forEach((b) =>
      b.setAttribute("aria-pressed", String(b.dataset.view === state.view)),
    );
  let tabs = $("#compare-tabs");
  if (state.stage === 5) {
    if (!tabs) {
      tabs = document.createElement("div");
      tabs.id = "compare-tabs";
      tabs.className = "compare-tabs glass";
      tabs.setAttribute("role", "group");
      tabs.setAttribute("aria-label", "Visible scenario");
      visual.append(tabs);
    }
    tabs.innerHTML = ["baseline", "alternative"]
      .map(
        (s) =>
          `<button data-scenario="${s}" aria-pressed="${state.scenario === s}">${s === "baseline" ? "Baseline" : "Alternative"}</button>`,
      )
      .join("");
  } else tabs?.remove();
  renderDecision();
  renderConversation();
  renderMode();
  updatePlayback();
  updateScene();
  $("#checkpoints").innerHTML = checkpoints
    .map(
      (c, i) =>
        `<button data-stage="${i}" ${i === state.stage ? 'aria-current="step"' : ""}><span aria-hidden="true"></span>${c}</button>`,
    )
    .join("");
  $("#checkpoint-count").textContent =
    `${String(state.stage + 1).padStart(2, "0")} / 07`;
  const field = $("#stations");
  if (field)
    field.addEventListener("input", () => {
      state.stations = Number(field.value);
      $("#stations-value").textContent = "2 → " + state.stations;
      field.setAttribute(
        "aria-valuetext",
        state.stations + " service stations",
      );
      updateScene();
    });
}
function renderConversation() {
  const html = stageConversation();
  $("#conversation").innerHTML = html;
  $("#voice-history-content").innerHTML = html;
  $("#contextual-actions").innerHTML = actions();
  const textPanel = $("#text-panel");
  textPanel.scrollTop = textPanel.scrollHeight;
}
function renderMode() {
  const voice = state.mode === "voice";
  $("#text-panel").hidden = voice;
  $("#voice-panel").hidden = !voice;
  $("#composer").hidden = voice;
  $("#composer-note").hidden = voice;
  for (const b of document.querySelectorAll("[data-mode]")) {
    const selected = b.dataset.mode === state.mode;
    b.setAttribute("aria-selected", String(selected));
    b.tabIndex = selected ? 0 : -1;
  }
  orb.setVisible(voice);
  orb.setState(state.muted ? "muted" : state.voicePhase);
  const isAlternative = state.scenario === "alternative";
  const contextLabel =
    state.stage === 3
      ? "Proposed alternative"
      : isAlternative
        ? "Alternative 1"
        : "Baseline";
  $("#voice-context").innerHTML =
    `<span class="eyebrow">CURRENT CONTEXT</span><h3>${sites[state.site].name} · ${contextLabel}</h3><p>${isAlternative ? state.stations : 2} stations · 3 staff · $6/order</p>`;
  updateVoice();
}
function updatePlayback() {
  $("#clock").textContent = clock(state.minute);
  $("#seek").value = Math.floor(state.minute);
  $("#seek").setAttribute("aria-valuetext", clock(state.minute));
  $("#playback-scenario").textContent =
    state.scenario === "baseline" ? "Baseline" : "Alternative";
  $("#play-pause").textContent = state.playing ? "Ⅱ" : "▶";
  $("#play-pause").setAttribute(
    "aria-label",
    state.playing ? "Pause replay" : "Play replay",
  );
}
function stopPlayback() {
  state.playing = false;
  cancelAnimationFrame(frame);
  frame = 0;
  lastTick = 0;
}
function play() {
  if (state.minute >= 60) state.minute = 0;
  state.playing = true;
  lastTick = 0;
  scheduleTick();
  updatePlayback();
}
function scheduleTick() {
  cancelAnimationFrame(frame);
  if (state.playing && !document.hidden) frame = requestAnimationFrame(tick);
}
function tick(now) {
  frame = 0;
  if (!state.playing || document.hidden) return;
  if (lastTick) {
    state.minute = Math.min(
      60,
      state.minute + ((now - lastTick) / 1000) * 3 * state.speed,
    );
  }
  lastTick = now;
  updatePlayback();
  if (state.stage === 4) $("#visual-content").innerHTML = metrics();
  updateScene();
  if (state.minute >= 60) {
    stopPlayback();
    if (state.scenario === "alternative") {
      state.stage = 5;
      render();
      announce("Example alternative complete. Compare with baseline.");
    } else {
      state.baselineDone = true;
      state.stage = 2;
      render();
      announce("Example baseline complete. You can now try an experiment.");
    }
  } else frame = requestAnimationFrame(tick);
}
function setStage(stage, shortcut = false) {
  stopPlayback();
  state.stage = Number(stage);
  customerSelected = false;
  $(".customer-tip")?.remove();
  if (state.stage >= 2 && state.stage <= 5) state.view = "interior";
  else state.view = "city";
  if (shortcut) {
    state.messages = [];
    seenMessages.clear();
    state.minute = state.stage >= 5 ? 60 : state.stage === 4 ? 32 : 0;
    state.baselineDone = state.stage >= 3;
    state.scenario = state.stage >= 3 ? "alternative" : "baseline";
    state.kept = state.stage === 6;
  }
  if (state.stage === 3) state.scenario = "alternative";
  render();
  announce("Preview checkpoint: " + checkpoints[state.stage]);
}
function selectSite(id) {
  if (!sites[id]) return;
  stopPlayback();
  const kept = keptPlans.get(id);
  Object.assign(state, {
    site: id,
    stage: 1,
    view: "city",
    stations: kept?.stations ?? 3,
    kept: !!kept,
    baselineDone: !!kept,
    scenario: kept ? "alternative" : "baseline",
    minute: 0,
  });
  render();
  announce(sites[id].name + " selected");
}
function run(baseline = false) {
  stopPlayback();
  state.scenario = baseline ? "baseline" : "alternative";
  state.minute = 0;
  state.view = "interior";
  state.stage = 4;
  render();
  play();
  announce(
    "Playing an illustrative " +
      (baseline ? "baseline" : "alternative") +
      " fixture.",
  );
}
function action(name) {
  const handlers = {
    select: () => selectSite(state.site),
    explore: () => setStage(0),
    "compare-sites": () => {
      state.messages.push({
        text: "These example spaces range from $4,200 to $4,800 per month. Select a space to inspect it with the same assumptions.",
        user: false,
      });
      renderConversation();
    },
    interior: () => {
      setStage(2);
    },
    baseline: () => run(true),
    experiment: () => {
      state.stations = state.kept ? state.stations : 3;
      setStage(3);
    },
    run: () => run(false),
    "cancel-experiment": () => {
      setStage(2);
    },
    queue: () => {
      state.view = "interior";
      render();
      announce("Queue highlighted in the modeled layout.");
    },
    customer: () => {
      customerSelected = !customerSelected;
      $(".customer-tip")?.remove();
      if (customerSelected) {
        const el = document.createElement("div");
        el.className = "customer-tip";
        el.innerHTML = `<strong>Customer 12 · Modeled</strong><p>${state.minute < 10 ? "Not yet arrived" : state.minute < 50 ? "Waiting · 2 min" : "Service completed"}</p>`;
        $(".visual-panel").append(el);
      }
    },
    compare: () => {
      state.minute = 60;
      state.scenario = "alternative";
      setStage(5);
    },
    keep: () => {
      keptPlans.set(state.site, { stations: state.stations });
      state.kept = true;
      state.scenario = "alternative";
      setStage(6);
      announce("Alternative kept in this example preview.");
    },
    revert: () => {
      keptPlans.delete(state.site);
      state.kept = false;
      state.stations = 2;
      state.scenario = "baseline";
      state.baselineDone = true;
      state.minute = 60;
      setStage(2);
      announce("Returned to the baseline example.");
    },
    "another-location": () => setStage(0),
  };
  handlers[name]?.();
}
function submitMessage(text) {
  const value = text.trim();
  if (!value) return;
  state.messages.push({ text: value, user: true });
  let response =
    "This preview uses example replies. Explore the location, open its interior, or test a service-station change using the controls.";
  if (/station|staff|what if|experiment|hours/i.test(value)) {
    state.messages.push({
      text: "Let’s preview a service-station change. Demand, staff, and price stay the same; you choose when to run it.",
      user: false,
    });
    state.stations = 3;
    setStage(3);
  } else if (/interior|inside|layout/i.test(value)) {
    setStage(2);
  } else if (/compare|baseline/i.test(value) && state.baselineDone) {
    state.minute = 60;
    setStage(5);
  } else if (/space [abc]/i.test(value)) {
    selectSite(value.match(/space ([abc])/i)[1].toUpperCase());
  } else {
    state.messages.push({ text: response, user: false });
    renderConversation();
  }
}
function updateVoice() {
  const phase = state.muted ? "muted" : state.voicePhase;
  const labels = {
    idle: ["Ready when you are", "Try the voice interaction."],
    listening: ["Listening…", "The orb responds to example speech energy."],
    thinking: ["Thinking…", "Keeping your selected space in context."],
    speaking: ["Speaking…", "A contextual response, in the same conversation."],
    muted: ["Microphone muted", "Demo paused. Your conversation stays here."],
  };
  $("#voice-status").textContent = labels[phase][0];
  $("#voice-caption").textContent = labels[phase][1];
  $("#voice-start").hidden = phase !== "idle";
  $("#voice-mute").hidden = phase === "idle";
  $("#voice-end").hidden = phase === "idle";
  $("#voice-mute").setAttribute("aria-pressed", String(state.muted));
  $("#voice-mute").setAttribute(
    "aria-label",
    state.muted ? "Unmute microphone demo" : "Mute microphone demo",
  );
  orb.setState(phase);
}
function clearVoiceTimers() {
  clearTimeout(voiceTimer);
  clearTimeout(voiceEndTimer);
}
function voicePhase(phase) {
  state.voicePhase = phase;
  updateVoice();
}
function startVoice() {
  clearVoiceTimers();
  state.muted = false;
  $("#live-transcript").textContent = "“What would adding a station change?”";
  voicePhase("listening");
  voiceTimer = setTimeout(() => {
    if (state.muted) return;
    voicePhase("thinking");
    voiceTimer = setTimeout(() => {
      if (state.muted) return;
      voicePhase("speaking");
      state.messages.push(
        { text: "What would adding a station change?", user: true },
        {
          text: "We can test another station while keeping demand, staff, and price the same. You decide when to run it.",
          user: false,
        },
      );
      renderConversation();
      $("#live-transcript").textContent =
        "“Let’s test one extra station against your baseline.”";
      voiceEndTimer = setTimeout(() => {
        if (!state.muted) {
          voicePhase("listening");
          $("#live-transcript").textContent =
            "Try another question, or switch back to Text.";
        }
      }, 4000);
    }, 1400);
  }, 3200);
}
function setMode(mode) {
  state.mode = mode;
  renderMode();
  announce(
    mode === "voice"
      ? "Voice preview. No microphone connected."
      : "Text conversation",
  );
}
document.addEventListener("click", (event) => {
  const actionButton = event.target.closest("[data-action]");
  if (actionButton) {
    action(actionButton.dataset.action);
    return;
  }
  const siteButton = event.target.closest("[data-site]");
  if (siteButton) {
    selectSite(siteButton.dataset.site);
    return;
  }
  const stageButton = event.target.closest("button[data-stage]");
  if (stageButton) {
    setStage(stageButton.dataset.stage, true);
    return;
  }
  const viewButton = event.target.closest("[data-view]");
  if (viewButton) {
    state.view = viewButton.dataset.view;
    render();
    return;
  }
  const modeButton = event.target.closest("button[data-mode]");
  if (modeButton) {
    setMode(modeButton.dataset.mode);
    return;
  }
  const scenarioButton = event.target.closest("[data-scenario]");
  if (scenarioButton) {
    state.scenario = scenarioButton.dataset.scenario;
    render();
  }
});
$(".mode-switch").addEventListener("keydown", (event) => {
  if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
    event.preventDefault();
    const mode =
      event.key === "Home"
        ? "text"
        : event.key === "End"
          ? "voice"
          : state.mode === "text"
            ? "voice"
            : "text";
    setMode(mode);
    $(`#${mode}-tab`).focus();
  }
});
$("#chat-input").addEventListener("input", (event) => {
  state.draft = event.target.value;
  event.target.style.height = "auto";
  event.target.style.height = Math.min(90, event.target.scrollHeight) + "px";
});
$("#composer").addEventListener("submit", (event) => {
  event.preventDefault();
  const value = $("#chat-input").value;
  $("#chat-input").value = "";
  state.draft = "";
  submitMessage(value);
});
$("#chat-input").addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    $("#composer").requestSubmit();
  }
});
$("#play-pause").addEventListener("click", () => {
  if (state.playing) {
    stopPlayback();
    updatePlayback();
  } else play();
});
$("#seek").addEventListener("input", (event) => {
  stopPlayback();
  state.minute = Number(event.target.value);
  updatePlayback();
  if (state.stage === 4) $("#visual-content").innerHTML = metrics();
  updateScene();
});
$("#speed").addEventListener("change", (event) => {
  state.speed = Number(event.target.value);
});
$("#zoom-in").addEventListener("click", () => scene.zoom(1));
$("#zoom-out").addEventListener("click", () => scene.zoom(-1));
$("#reset-camera").addEventListener("click", () => scene.reset());
$("#voice-start").addEventListener("click", startVoice);
$("#voice-end").addEventListener("click", () => {
  clearVoiceTimers();
  state.muted = false;
  voicePhase("idle");
  $("#live-transcript").textContent = "";
});
$("#voice-mute").addEventListener("click", () => {
  state.muted = !state.muted;
  if (state.muted) {
    clearVoiceTimers();
    updateVoice();
  } else startVoice();
});
$("#history-toggle").addEventListener("click", () => {
  if (state.mode === "voice") {
    $("#voice-history").open = !$("#voice-history").open;
  } else {
    $("#conversation").focus();
  }
});
$("#reset").addEventListener("click", () => {
  clearVoiceTimers();
  stopPlayback();
  Object.assign(state, { ...initial, messages: [] });
  keptPlans.clear();
  seenMessages.clear();
  $("#chat-input").value = "";
  $("#live-transcript").textContent = "";
  render();
  announce("Preview restarted");
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    cancelAnimationFrame(frame);
    frame = 0;
    lastTick = 0;
    clearVoiceTimers();
    if (state.voicePhase !== "idle") {
      state.voicePhase = "idle";
      state.muted = false;
      updateVoice();
    }
  } else scheduleTick();
});
window.addEventListener("pagehide", () => {
  stopPlayback();
  clearVoiceTimers();
  orb.dispose();
  scene.dispose?.();
});
render();
try {
  const { createScene } = await import("./scene.js");
  scene = createScene($("#scene"), selectSite);
  updateScene();
} catch {
  $("#scene-fallback").hidden = false;
  $("#map-pins").hidden = true;
}
// Read-only status is useful for preview verification; this is not a production contract.
window.bizboxPreview = {
  getState: () => ({
    ...state,
    messages: state.messages.map((m) => ({ ...m })),
    graphics: scene.mode,
  }),
  getAnimationState: () => ({
    playbackFrame: !!frame,
    playing: state.playing,
    hidden: document.hidden,
    voicePhase: state.voicePhase,
  }),
};
