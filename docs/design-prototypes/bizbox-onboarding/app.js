/* global BizBoxLiquid */
/* Standalone BizBox design study. No models, simulations, or external requests. */
const main = document.querySelector("#main");
const questionSteps = [
  "category",
  "concept",
  "target",
  "city",
  "areas",
  "rent",
  "buildout",
  "price",
  "hours",
  "staff",
  "must",
];
const steps = [...questionSteps, "review", "workspace"];
const aliases = {
  business: "category",
  location: "city",
  budget: "rent",
  operations: "price",
};
const labels = {
  category: "Business type",
  concept: "Concept",
  target: "Customers",
  city: "City",
  areas: "Areas",
  rent: "Monthly rent",
  buildout: "Buildout",
  price: "Price tier",
  hours: "Hours",
  staff: "Staffing",
  must: "Must-haves",
  review: "Review",
  workspace: "Workspace",
};
const cityPhotos = {
  "Los Angeles": "photos/la-real.jpg",
  Houston: "photos/houston-real.jpg",
};
const comingSoonCities = ["New York", "Chicago", "Miami"];
const availableCategories = ["Coffee shop", "Quick food", "Salon", "Fitness"];
const params = new URLSearchParams(location.search);
const canonical = (value) => aliases[value] || value;
let step = steps.includes(canonical(params.get("step")))
  ? canonical(params.get("step"))
  : "category";
let theme = params.get("theme") === "day" ? "day" : "night";
let data = {
  category: "Coffee shop",
  concept: "",
  target: "",
  city: "Los Angeles",
  neighborhoods: ["Silver Lake"],
  preferences: "",
  rent: "4500",
  buildout: "80000",
  price: "Mid-range",
  hours: "7 am – 6 pm",
  staff: "2",
  must: "",
};
const sample = {
  concept: "A neighborhood coffee shop with room to work and meet.",
  target: "Local residents and people working nearby",
  preferences: "Walkable streets, near homes and offices",
  must: "Street frontage and room for seating",
};
try {
  const saved = JSON.parse(
    sessionStorage.getItem("bizbox-la-design-onboarding") || "null",
  );
  if (saved && typeof saved === "object") data = { ...data, ...saved };
} catch {}
if (!availableCategories.includes(data.category)) {
  data.category = "";
  step = "category";
}
if (step === "review" || step === "workspace")
  data = {
    ...data,
    ...Object.fromEntries(Object.entries(sample).filter(([key]) => !data[key])),
  };
let isTransitioning = false;
const esc = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const arrow =
  '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M4 10h11m-4-4 4 4-4 4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const backArrow =
  '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M16 10H5m4-4-4 4 4 4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const icons = {
  "Coffee shop":
    '<path d="M5 8h10v6a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4V8Zm10 1h2a2.5 2.5 0 0 1 0 5h-2M8 3v2m4-2v2M4 21h13"/>',
  "Quick food":
    '<path d="M4 10h16M5 10a7 7 0 0 1 14 0M4 14h16M5 18h14M7 6h.1M11 5h.1M15 6h.1"/>',
  Salon:
    '<circle cx="6" cy="17" r="3"/><circle cx="18" cy="17" r="3"/><path d="m8 15 9-11M16 15 7 4m4 6 2 3"/>',
  Fitness: '<path d="M7 8v8m10-8v8M4 10v4m16-4v4M7 12h10"/>',
  Other: '<path d="m4 8 8-4 8 4v9l-8 4-8-4V8Zm0 0 8 4 8-4M12 12v9"/>',
};
const icon = (name = "Coffee shop") =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.Other}</svg>`;
const money = (value) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(Number(value));
function persist() {
  try {
    sessionStorage.setItem("bizbox-la-design-onboarding", JSON.stringify(data));
  } catch {}
}
function updateURL() {
  const url = new URL(location.href);
  url.searchParams.set("step", step);
  url.searchParams.set("theme", theme);
  history.replaceState({ step, theme }, "", url);
}
function syncParent() {
  if (parent !== window)
    parent.postMessage({ type: "bizbox:step", step }, location.origin);
}
function setCityBackdrop() {
  const city = cityPhotos[data.city] ? data.city : "Los Angeles";
  document.body.style.setProperty("--city-photo", `url("${cityPhotos[city]}")`);
  document.body.dataset.city = city;
  window.BizBoxLiquid?.setPhoto(cityPhotos[city]);
}
function setTheme(value) {
  theme = value === "day" ? "day" : "night";
  document.body.dataset.theme = theme;
  document
    .querySelectorAll(".material-switch [data-theme]")
    .forEach((b) =>
      b.setAttribute("aria-pressed", String(b.dataset.theme === theme)),
    );
  updateURL();
}
document
  .querySelectorAll(".material-switch button")
  .forEach((button) =>
    button.addEventListener("click", () => setTheme(button.dataset.theme)),
  );
function setBusy(value) {
  isTransitioning = value;
  document.body.classList.toggle("is-transitioning", value);
  document.body.dataset.liquidActive = String(value);
  document
    .querySelectorAll(".card-footer button")
    .forEach((b) => (b.disabled = value));
}
async function navigate(next, focus = true, trigger = null) {
  next = canonical(next);
  if (!steps.includes(next) || isTransitioning) return false;
  persist();
  if (next === step) return replayLiquid();
  main.querySelectorAll(".liquid-slider").forEach((el) => el.ruler?.destroy());
  const previous = step,
    direction = steps.indexOf(next) >= steps.indexOf(step) ? 1 : -1,
    card = document.querySelector(".onboard-card");
  setBusy(true);
  const swap = () => {
    step = next;
    updateURL();
    render();
    setBusy(true);
    if (focus) document.querySelector("h1")?.focus({ preventScroll: true });
    syncParent();
  };
  try {
    if (card && next !== "workspace" && window.BizBoxLiquid)
      await BizBoxLiquid.transition({ card, trigger, direction, swap });
    else swap();
  } finally {
    setBusy(false);
  }
  return previous !== step;
}
async function replayLiquid() {
  if (isTransitioning) return false;
  const card = document.querySelector(".onboard-card");
  if (!card) return false;
  setBusy(true);
  try {
    await BizBoxLiquid.transition({
      card,
      trigger: card.querySelector(".primary"),
      direction: 1,
      swap: () => {},
    });
  } finally {
    setBusy(false);
  }
  return true;
}
const questions = {
  category: { title: "What are you opening?" },
  concept: { title: "Describe your business." },
  target: { title: "Who is it for?" },
  city: { title: "Where are you looking?" },
  areas: { title: "Which areas should we favor or avoid?" },
  rent: { title: "What’s your monthly rent limit?" },
  buildout: { title: "What’s your buildout budget?" },
  price: { title: "Where will your prices sit?" },
  hours: { title: "When will you be open?" },
  staff: { title: "How many people will be on shift?" },
  must: { title: "Anything the space must have?" },
};
function textAnswer(
  name,
  {
    textarea = false,
    placeholder = "",
    type = "text",
    min,
    max,
    maxlength = 250,
    required = false,
  } = {},
) {
  const attrs = `name="${name}" aria-labelledby="step-title" ${required ? "required" : ""} ${min !== undefined ? `min="${min}"` : ""} ${max !== undefined ? `max="${max}"` : ""} maxlength="${maxlength}" placeholder="${esc(placeholder)}"`;
  return textarea
    ? `<textarea ${attrs}>${esc(data[name])}</textarea>`
    : `<input ${attrs} type="${type}" ${type === "number" ? 'inputmode="numeric" step="1"' : ""} value="${esc(data[name])}">`;
}
function sliderAnswer(
  name,
  { min, max, step: increment = 1, currency = false },
) {
  const ceiling = Math.max(max, Number(data[name]) || 0),
    floor = Math.min(min, Number(data[name]) || 0);
  return `<div class="tactile-range"><div class="${currency ? "currency" : "quantity"}">${currency ? '<span aria-hidden="true">$</span>' : ""}${textAnswer(name, { type: "number", required: true, min: currency ? 0 : 1, max: currency ? 100000000 : 500 })}</div><div class="ruler-surface"><canvas aria-hidden="true"></canvas><span class="ruler-marker" aria-hidden="true"></span><input class="liquid-slider" type="range" role="slider" data-bind="${name}" min="${floor}" max="${ceiling}" step="any" data-detent="${increment}" value="${esc(data[name])}" aria-label="${esc(questions[step].title)}" aria-valuetext="${currency ? money(data[name]) : esc(data[name])}"></div><div class="range-bounds" aria-hidden="true"><span>${currency ? money(floor) : floor}</span><span>${currency ? money(ceiling) : ceiling}</span></div></div>`;
}
function answerHTML() {
  switch (step) {
    case "category":
      return `<div class="choice-grid" role="group" aria-labelledby="step-title">${[...availableCategories, "Other"].map((name) => `<button type="button" class="choice" data-category="${name}" aria-pressed="${data.category === name}" ${name === "Other" ? 'disabled aria-label="Other — Coming soon"' : ""}>${icon(name)}${name}${name === "Other" ? '<span class="choice-coming-soon">Coming soon</span>' : ""}</button>`).join("")}</div>`;
    case "concept":
      return textAnswer("concept", {
        textarea: true,
        required: true,
        maxlength: 400,
        placeholder: "A neighborhood coffee shop with room to work and meet…",
      });
    case "target":
      return textAnswer("target", {
        textarea: true,
        required: true,
        maxlength: 250,
        placeholder: "Residents, commuters, students…",
      });
    case "city":
      return `<div class="cities" role="group" aria-labelledby="step-title">${["Los Angeles", "Houston"].map((city) => `<button type="button" class="city-choice" data-city="${city}" aria-pressed="${data.city === city}"><div class="city-photo"><img src="${cityPhotos[city]}" data-photo-city="${city}" alt="" width="640" height="360"></div><span class="city-label">${city}<span class="radio-mark" aria-hidden="true"></span></span></button>`).join("")}</div>${comingSoonCities.length ? `<div class="coming-soon-cities" role="group" aria-label="Coming soon cities">${comingSoonCities.map((city) => `<button type="button" class="coming-city" disabled aria-label="${esc(city)} — Coming soon"><strong>${esc(city)}</strong><span>Coming soon</span></button>`).join("")}</div>` : ""}`;
    case "areas": {
      const names =
        data.city === "Houston"
          ? ["Montrose", "The Heights", "Rice Village"]
          : ["Silver Lake", "Echo Park", "Culver City"];
      return `${textAnswer("preferences", { textarea: true, placeholder: "Walkable streets, near offices. Avoid shopping centers…" })}<div class="neighborhoods" role="group" aria-label="Preferred neighborhoods">${names.map((name) => `<button type="button" class="chip" data-neighborhood="${name}" aria-pressed="${data.neighborhoods.includes(name)}">${name}</button>`).join("")}</div>`;
    }
    case "rent":
      return sliderAnswer("rent", {
        min: 500,
        max: 20000,
        step: 100,
        currency: true,
      });
    case "buildout":
      return sliderAnswer("buildout", {
        min: 0,
        max: 500000,
        step: 5000,
        currency: true,
      });
    case "price":
      return `<div class="choice-grid price-choices" role="group" aria-labelledby="step-title">${["Value", "Mid-range", "Premium"].map((value) => `<button type="button" class="choice" data-price="${value}" aria-pressed="${data.price === value}">${value}</button>`).join("")}</div>`;
    case "hours":
      return textAnswer("hours", {
        required: true,
        maxlength: 80,
        placeholder: "7 am – 6 pm",
      });
    case "staff":
      return sliderAnswer("staff", { min: 1, max: 30 });
    case "must":
      return textAnswer("must", {
        textarea: true,
        maxlength: 300,
        placeholder: "Street frontage, outdoor seating, room for two counters…",
      });
  }
}
function review() {
  const rows = [
    ["Customers", data.target, "target"],
    ["City", data.city, "city"],
    [
      "Areas",
      [data.neighborhoods.join(", "), data.preferences]
        .filter(Boolean)
        .join(" · ") || "No preference",
      "areas",
    ],
    ["Monthly rent", money(data.rent), "rent"],
    ["Buildout", money(data.buildout), "buildout"],
    ["Price tier", data.price, "price"],
    ["Hours", data.hours, "hours"],
    ["Staff", `${data.staff} on shift`, "staff"],
    ["Must-haves", data.must || "None added", "must"],
  ];
  return `<div class="review-concept"><span class="concept-icon">${icon(data.category)}</span><h2>${esc(data.category)}</h2><p>${esc(data.concept)}</p><button type="button" class="edit" data-step="concept" aria-label="Edit concept">Edit concept</button></div><dl class="review-list">${rows.map(([label, value, dest]) => `<div class="review-row"><dt>${label}</dt><dd>${esc(value)}</dd><button type="button" class="edit" data-step="${dest}" aria-label="Edit ${label.toLowerCase()}">Edit</button></div>`).join("")}</dl>`;
}
function render() {
  document.body.classList.toggle("workspace", step === "workspace");
  setCityBackdrop();
  document.querySelector("#preview-nav").innerHTML = steps
    .map(
      (s) =>
        `<a href="?step=${s}&theme=${theme}" data-step="${s}" ${s === step ? 'aria-current="page"' : ""}>${labels[s]}</a>`,
    )
    .join("");
  if (step === "workspace") {
    window.BizBoxLiquid?.mount(null);
    renderWorkspace();
    return;
  }
  const isReview = step === "review",
    index = questionSteps.indexOf(step),
    title = isReview ? "Review" : questions[step].title;
  const markup = `<section class="onboard-card question-card" aria-labelledby="step-title"><span class="card-surface" aria-hidden="true"></span><form id="onboard-form"><div class="card-content ${isReview ? "review" : step}"><div class="question-scene"><h1 id="step-title" tabindex="-1">${title}</h1><div class="question-answer">${isReview ? review() : answerHTML()}</div><p class="error" role="alert" id="form-error"></p></div></div><div class="card-footer">${index > 0 || isReview ? `<button type="button" class="back" data-step="${isReview ? "must" : questionSteps[index - 1]}">${backArrow}Back</button>` : "<span></span>"}<div class="footer-actions">${step === "must" ? '<button type="button" class="skip" id="skip-question">Skip</button>' : ""}<button type="submit" class="primary">${isReview ? "Explore locations" : "Continue"}${arrow}</button></div></div></form></section>`;
  const template = document.createElement("template");
  template.innerHTML = markup;
  const next = template.content.firstElementChild,
    current = main.querySelector(".onboard-card");
  if (current) {
    current.querySelector(".card-top")?.remove();
    current
      .querySelector("#onboard-form")
      .replaceWith(next.querySelector("#onboard-form"));
  } else {
    main.replaceChildren(next);
  }
  bind();
  window.BizBoxLiquid?.mount(main.querySelector(".onboard-card"));
}
function validate() {
  const error = document.querySelector("#form-error");
  let message = "";
  if (step === "category" && !availableCategories.includes(data.category))
    message = "Choose an available business type.";
  if (
    ["concept", "target", "hours"].includes(step) &&
    !String(data[step]).trim()
  )
    message = "Add your answer to continue.";
  if (
    step === "rent" &&
    (!Number.isFinite(Number(data.rent)) || Number(data.rent) <= 0)
  )
    message = "Enter a monthly rent limit greater than zero.";
  if (
    step === "buildout" &&
    (!Number.isFinite(Number(data.buildout)) ||
      Number(data.buildout) < 0 ||
      data.buildout === "")
  )
    message = "Enter zero or a positive buildout budget.";
  if (
    step === "staff" &&
    (!Number.isInteger(Number(data.staff)) || Number(data.staff) < 1)
  )
    message = "Enter at least one person, using a whole number.";
  if (error) error.textContent = message;
  return !message;
}
function syncRange(name, value) {
  const range = main.querySelector(`[data-bind="${name}"]`);
  if (!range) return;
  if (value !== "" && Number.isFinite(Number(value))) {
    if (Number(value) > Number(range.max)) range.max = value;
    if (Number(value) < Number(range.min)) range.min = value;
  }
  range.value = value;
  const bounds = range
    .closest(".tactile-range")
    .querySelectorAll(".range-bounds span");
  bounds[0].textContent = name === "staff" ? range.min : money(range.min);
  bounds[1].textContent = name === "staff" ? range.max : money(range.max);
  range.style.setProperty(
    "--fill",
    `${(100 * (Number(range.value) - Number(range.min))) / (Number(range.max) - Number(range.min))}%`,
  );
  range.setAttribute("aria-valuetext", name === "staff" ? value : money(value));
  range.ruler?.draw();
}
function bind() {
  main.querySelectorAll(".liquid-slider").forEach((range) => {
    syncRange(range.dataset.bind, range.value);
    range.addEventListener("input", () => {
      const name = range.dataset.bind;
      data[name] = range.value;
      main.querySelector(`[name="${name}"]`).value = range.value;
      syncRange(name, range.value);
      persist();
      BizBoxLiquid.impulse(0.3);
    });
    window.BizBoxRuler?.mount(range);
  });
  document.querySelectorAll("[data-step]").forEach(
    (button) =>
      (button.onclick = (event) => {
        event.preventDefault();
        navigate(button.dataset.step, true, button);
      }),
  );
  main
    .querySelectorAll(
      "#onboard-form input[name],#onboard-form textarea[name],#onboard-form select[name]",
    )
    .forEach((el) => {
      el.addEventListener("input", () => {
        data[el.name] = el.value;
        syncRange(el.name, el.value);
        persist();
      });
      el.addEventListener("change", () => {
        data[el.name] = el.value;
        syncRange(el.name, el.value);
        persist();
      });
    });
  main.querySelectorAll("[data-category]").forEach(
    (button) =>
      (button.onclick = () => {
        if (
          isTransitioning ||
          button.disabled ||
          !availableCategories.includes(button.dataset.category)
        )
          return;
        data.category = button.dataset.category;
        main
          .querySelectorAll("[data-category]")
          .forEach((el) =>
            el.setAttribute("aria-pressed", String(el === button)),
          );
        persist();
        BizBoxLiquid.select(button);
      }),
  );
  main.querySelectorAll("[data-city]").forEach(
    (button) =>
      (button.onclick = () => {
        if (isTransitioning) return;
        if (data.city !== button.dataset.city) {
          data.city = button.dataset.city;
          data.neighborhoods = [];
          setCityBackdrop();
        }
        main
          .querySelectorAll("[data-city]")
          .forEach((el) =>
            el.setAttribute("aria-pressed", String(el === button)),
          );
        persist();
        BizBoxLiquid.select(button);
      }),
  );
  main.querySelectorAll("[data-price]").forEach(
    (button) =>
      (button.onclick = () => {
        if (isTransitioning) return;
        data.price = button.dataset.price;
        main
          .querySelectorAll("[data-price]")
          .forEach((el) =>
            el.setAttribute("aria-pressed", String(el === button)),
          );
        persist();
        BizBoxLiquid.select(button);
      }),
  );
  main.querySelectorAll("[data-neighborhood]").forEach(
    (button) =>
      (button.onclick = () => {
        if (isTransitioning) return;
        const name = button.dataset.neighborhood;
        data.neighborhoods = data.neighborhoods.includes(name)
          ? data.neighborhoods.filter((x) => x !== name)
          : [...data.neighborhoods, name];
        button.setAttribute(
          "aria-pressed",
          String(data.neighborhoods.includes(name)),
        );
        persist();
        BizBoxLiquid.select(button);
      }),
  );
  const form = document.querySelector("#onboard-form");
  if (form)
    form.onsubmit = (event) => {
      event.preventDefault();
      if (isTransitioning || !validate()) return;
      navigate(steps[steps.indexOf(step) + 1], true, event.submitter);
    };
  document
    .querySelector("#skip-question")
    ?.addEventListener("click", (event) => {
      if (isTransitioning) return;
      data.must = "";
      navigate("review", true, event.currentTarget);
    });
}
let chatMessages = [];
let alternativeStaff = null;
let chatMode = "text";
let chatDraft = "";
let locationExpanded = false;
let voiceHistoryOpen = false;
const chatIcon =
  '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><path d="M16.5 9.5a6.5 6.5 0 0 1-6.5 6.5H4l-2 2V9.5a7.25 7.25 0 0 1 14.5 0Z"/><path d="M6 8h7M6 11h4" stroke-linecap="round"/></svg>';
const micIcon =
  '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><rect x="7" y="2" width="6" height="10" rx="3"/><path d="M4.5 9a5.5 5.5 0 0 0 11 0M10 14.5V18m-3 0h6" stroke-linecap="round"/></svg>';
const pinIcon =
  '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M10 18s6-6 6-11A6 6 0 0 0 4 7c0 5 6 11 6 11Z"/><circle cx="10" cy="7" r="2"/></svg>';
function conversationHTML() {
  return `<div class="conversation" role="log" aria-label="Conversation" aria-live="polite"><p class="assistant-message">What would you like to know about this space?</p>${chatMessages.length ? "" : `<button class="suggestion" id="staff-suggestion">Add a staff member<span aria-hidden="true">+</span></button>`}${chatMessages.map((m) => `<p class="${m.role === "user" ? "user-message" : "assistant-message"}">${esc(m.text)}</p>`).join("")}</div>`;
}
function changeChatMode(mode, focus = false) {
  if (!["text", "voice"].includes(mode) || chatMode === mode) return;
  chatMode = mode;
  renderWorkspace();
  if (focus)
    document.querySelector(`#mode-${mode}`).focus({ preventScroll: true });
}
function renderWorkspace() {
  const currentDetails = document.querySelector("#selected-location");
  const currentHistory = document.querySelector(".voice-history");
  if (currentDetails) locationExpanded = currentDetails.open;
  if (currentHistory) voiceHistoryOpen = currentHistory.open;
  const selectedSite =
    data.city === "Houston" ? "Montrose storefront" : "Silver Lake storefront";
  const category = data.category === "Other" ? "Your business" : data.category;
  const transcript = conversationHTML();
  main.innerHTML = `
    <div class="workspace-layout">
      <header class="workspace-topbar">
        <div><h1 tabindex="-1">${esc(data.city)}</h1><p>${esc(category)}<span aria-hidden="true"> / </span><span>${money(data.rent)}/mo limit</span></p></div>
        <button class="brief-button" id="edit-profile">Edit brief<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true"><path d="m12 4 4 4M3 17l4-1L17 6l-3-3L4 13l-1 4Z"/></svg></button>
      </header>
      <div class="workspace-body">
        <section class="location-panel" aria-label="Selected location preview">
          <div class="location-photo" aria-hidden="true"></div>
          <span class="city-preview-label">City preview</span>
          <button class="selected-pin" id="select-site" aria-label="Show selected space details" aria-controls="selected-location" aria-expanded="${locationExpanded}">${pinIcon}</button>
          <details class="location-summary" id="selected-location" ${locationExpanded ? "open" : ""}>
            <summary><div class="location-name"><h2>${selectedSite}</h2><span class="sample-badge">Example</span></div>
              <dl class="location-stats"><div><dt>Monthly rent</dt><dd>$3,867</dd></div><div><dt>Area</dt><dd>1,450 <span>sq ft</span></dd></div></dl>
              <span class="location-disclosure"><span>Details</span><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="m6 8 4 4 4-4"/></svg></span>
            </summary>
            <p class="location-description">Corner space with street frontage and room for seating. Example listing; the photograph shows the city.</p>
          </details>
        </section>
        <aside class="chat-panel" data-mode="${chatMode}" aria-label="Business assistant">
          <header class="chat-header"><div class="assistant-heading"><h2>Assistant</h2><span class="preview-badge" title="Scripted design preview">Preview</span></div>
            <div class="chat-mode" role="tablist" aria-label="Chat mode">${["text", "voice"].map((mode) => `<button id="mode-${mode}" role="tab" aria-selected="${chatMode === mode}" aria-controls="chat-interaction" tabindex="${chatMode === mode ? "0" : "-1"}" data-chat-mode="${mode}">${mode === "text" ? chatIcon : micIcon}${mode === "text" ? "Text" : "Voice"}</button>`).join("")}</div>
          </header>
          <div class="chat-interaction" id="chat-interaction" role="tabpanel" aria-labelledby="mode-${chatMode}">
            ${chatMode === "text" ? transcript : `<div class="voice-stage"><div class="voice-orb" aria-hidden="true"><span></span></div><p>Microphone not connected</p><button class="voice-mic" disabled aria-label="Voice is not connected in this design preview">${micIcon}</button></div><details class="voice-history" ${voiceHistoryOpen ? "open" : ""}><summary>Conversation<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><path d="m6 8 4 4 4-4"/></svg></summary>${transcript}</details>`}
          </div>
          ${alternativeStaff ? `<section class="diff-card" aria-label="Proposed staffing change"><div class="staffing-change"><h3>Staffing</h3><p>${esc(data.staff)} ${arrow} <strong>${alternativeStaff}</strong><span>on shift</span></p></div><p class="change-note">Preview · no simulation run</p><div class="diff-actions"><button class="keep" id="keep">Keep change</button><button id="revert">Revert</button></div></section>` : ""}
          ${chatMode === "text" ? `<div class="chat-compose"><form id="chat-form"><input name="message" aria-label="Message BizBox assistant" placeholder="Ask about this space…" maxlength="300" value="${esc(chatDraft)}" required><button aria-label="Send message"><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M10 15V5m-4 4 4-4 4 4" stroke-linecap="round" stroke-linejoin="round"/></svg></button></form></div>` : ""}
        </aside>
      </div>
    </div>`;
  bind();
  document.querySelector("#edit-profile").onclick = () => navigate("review");
  const locationDetails = document.querySelector("#selected-location");
  const selectedPin = document.querySelector("#select-site");
  selectedPin.onclick = () => {
    locationDetails.open = !locationDetails.open;
  };
  locationDetails.addEventListener("toggle", () =>
    selectedPin.setAttribute("aria-expanded", String(locationDetails.open)),
  );
  document.querySelectorAll("[data-chat-mode]").forEach((button) => {
    button.onclick = () => changeChatMode(button.dataset.chatMode, true);
    button.onkeydown = (event) => {
      if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
        event.preventDefault();
        changeChatMode(
          event.key === "Home"
            ? "text"
            : event.key === "End"
              ? "voice"
              : chatMode === "text"
                ? "voice"
                : "text",
          true,
        );
      }
    };
  });
  document
    .querySelector("#staff-suggestion")
    ?.addEventListener("click", () => sendChat("Add one staff member."));
  const chatForm = document.querySelector("#chat-form");
  if (chatForm) {
    chatForm.elements.message.addEventListener("input", (event) => {
      chatDraft = event.target.value;
    });
    chatForm.onsubmit = (event) => {
      event.preventDefault();
      const text = chatDraft.trim();
      if (text) {
        chatDraft = "";
        sendChat(text);
        document
          .querySelector("#chat-form input")
          ?.focus({ preventScroll: true });
      }
    };
  }
  if (alternativeStaff) {
    document.querySelector("#keep").onclick = () => {
      data.staff = String(alternativeStaff);
      alternativeStaff = null;
      chatMessages.push({
        role: "assistant",
        text: `Kept ${data.staff} staff in this preview.`,
      });
      persist();
      renderWorkspace();
      document
        .querySelector(`#mode-${chatMode}`)
        .focus({ preventScroll: true });
    };
    document.querySelector("#revert").onclick = () => {
      alternativeStaff = null;
      chatMessages.push({
        role: "assistant",
        text: "Kept your original staffing.",
      });
      renderWorkspace();
      document
        .querySelector(`#mode-${chatMode}`)
        .focus({ preventScroll: true });
    };
  }
  const conversation = document.querySelector(".conversation");
  if (conversation) conversation.scrollTop = conversation.scrollHeight;
}
function sendChat(text) {
  chatMessages.push({ role: "user", text });
  if (/staff|employee|hire/i.test(text))
    alternativeStaff = Number(data.staff) + 1;
  else
    chatMessages.push({
      role: "assistant",
      text: "This preview supports staffing changes. Try “add one employee”.",
    });
  renderWorkspace();
}

window.bizboxMockup = {
  getState: () => ({
    step,
    theme,
    data: { ...data },
    alternativeStaff,
    chatMode,
    chatDraft,
    chatMessages: chatMessages.map((message) => ({ ...message })),
    isTransitioning,
  }),
  navigate,
  replayLiquid,
};
setTheme(theme);
render();
syncParent();
