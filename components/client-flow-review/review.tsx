"use client";

import { useState, type FormEvent } from "react";
import { WorkspaceShell } from "@/components/workspace-screen/workspace-shell";
import { PropertyDetails } from "@/components/workspace-screen/property-details";
import { ComparisonChart } from "@/components/workspace-screen/comparison-chart";
import { GradientOrb } from "@/components/voice/gradient-orb";
import { projectCashBuffer, upfrontCostCents } from "@/lib/nessie/projection";
import styles from "./review.module.css";
import {
  accounts,
  initialExperiment,
  initialSetup,
  reviewMetrics,
  reviewProperties,
  stages,
  type Experiment,
  type Setup,
  type Stage,
} from "./model";

const money = (value: number) =>
  value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
const same = (a: Setup, b: Setup) => JSON.stringify(a) === JSON.stringify(b);
type Message = { role: "user" | "scripted"; text: string };
function Schematic({
  stations,
  selected,
  onSelect,
}: {
  stations: number;
  selected: number;
  onSelect: (index: number) => void;
}) {
  return (
    <figure>
      <figcaption className={styles.muted}>
        Illustrative layout · not a measured floor plan
      </figcaption>
      <svg
        viewBox="0 0 600 260"
        className={styles.plan}
        role="img"
        aria-label={`${stations} illustrative service stations`}
      >
        <rect
          x="15"
          y="15"
          width="570"
          height="230"
          rx="15"
          fill="#ffffff07"
          stroke="#ffffff70"
          strokeWidth="2"
        />
        <path
          d="M30 165H570M420 30V230"
          stroke="#ffffff35"
          strokeDasharray="7 7"
        />
        <text x="40" y="216" fill="#dedee5" fontSize="16">
          Entry / waiting
        </text>
        <text x="445" y="216" fill="#dedee5" fontSize="16">
          Back of house
        </text>
        {Array.from({ length: stations }, (_, index) => (
          <g key={index}>
            <rect
              x={40 + (index % 4) * 90}
              y={45 + Math.floor(index / 4) * 58}
              width="70"
              height="42"
              rx="8"
              fill={selected === index ? "#f7f7fa" : "#ffffff1a"}
              stroke="#ffffff80"
            />
            <text
              x={75 + (index % 4) * 90}
              y={71 + Math.floor(index / 4) * 58}
              textAnchor="middle"
              fill={selected === index ? "#17181d" : "#f7f7fa"}
              fontSize="14"
            >
              {index + 1}
            </text>
          </g>
        ))}
      </svg>
      <div
        className={styles.nav}
        role="group"
        aria-label="Select illustrative station"
      >
        {Array.from({ length: stations }, (_, index) => (
          <button
            key={index}
            aria-pressed={selected === index}
            onClick={() => onSelect(index)}
          >
            Station {index + 1}
          </button>
        ))}
      </div>
    </figure>
  );
}

function ExperimentPanel({
  kind,
  experiment,
  onChange,
  onInterior,
}: {
  kind: "Outdoor" | "Indoor";
  experiment: Experiment;
  onChange: (next: Experiment) => void;
  onInterior: () => void;
}) {
  const [station, setStation] = useState(0);
  const changed = experiment.runChanged;
  const metrics =
    kind === "Outdoor"
      ? [
          { label: "Customers / month", before: 2300, after: 2600 },
          {
            label: "Operating contribution / month",
            before: 4500,
            after: 4900,
          },
        ]
      : [
          { label: "Served / day", before: 92, after: 112 },
          { label: "Wait / minutes", before: 8.2, after: 4.1 },
          { label: "Walkaways / day", before: 18, after: 7 },
        ];
  const fields: [keyof Setup, string, number, number, number][] =
    kind === "Outdoor"
      ? [
          ["hours", "Open hours / day", 6, 16, 1],
          ["staff", "Staff on shift", 1, 6, 1],
          ["stations", "Service stations", 1, 6, 1],
          ["ticket", "Average ticket / $", 4, 14, 1],
        ]
      : [
          ["stations", "Service stations", 1, 6, 1],
          ["staff", "Staff on shift", 1, 6, 1],
        ];
  return (
    <section className={styles.panel} aria-label={`${kind} experiment`}>
      <h2>{kind} experiment</h2>
      <p className={styles.muted}>
        Illustrative controls and sample outputs · no simulation service called
      </p>
      <div className={styles.controls}>
        {fields.map(([key, label, min, max, step]) => (
          <label key={key}>
            {label}
            <strong>{experiment.draft[key]}</strong>
            <input
              type="range"
              aria-label={label}
              min={min}
              max={max}
              step={step}
              value={experiment.draft[key]}
              onChange={(event) =>
                onChange({
                  ...experiment,
                  draft: {
                    ...experiment.draft,
                    [key]: Number(event.target.value),
                  },
                  run: null,
                  kept: false,
                })
              }
            />
          </label>
        ))}
      </div>
      <div className={styles.actions}>
        <button
          className={`${styles.button} ${styles.primary}`}
          onClick={() =>
            onChange({
              ...experiment,
              run: { ...experiment.draft },
              runBeforeChanged: experiment.currentChanged,
              runChanged: !same(experiment.draft, initialSetup),
              kept: false,
            })
          }
        >
          Run sample
        </button>
        {experiment.run && (
          <>
            <button
              className={styles.button}
              disabled={experiment.kept}
              onClick={() =>
                onChange({
                  ...experiment,
                  current: { ...experiment.run! },
                  currentChanged: experiment.runChanged,
                  kept: true,
                })
              }
            >
              {experiment.kept ? "Kept for this review" : "Keep change"}
            </button>
            <button
              className={styles.button}
              onClick={() =>
                onChange({
                  ...experiment,
                  draft: { ...experiment.current },
                  run: null,
                  kept: false,
                })
              }
            >
              Discard change
            </button>
          </>
        )}
        <button className={styles.button} onClick={onInterior}>
          {kind === "Outdoor" ? "View interior" : "Back to interior"}
        </button>
      </div>
      {kind === "Indoor" && (
        <Schematic
          stations={experiment.draft.stations}
          selected={Math.min(station, experiment.draft.stations - 1)}
          onSelect={setStation}
        />
      )}
      {experiment.run ? (
        <>
          <p className={styles.muted}>
            {experiment.kept
              ? "Change kept in this tab only."
              : "Current setup vs changed setup · fixed illustrative scenario"}
          </p>
          <div className={`${styles.grid} mt-6`}>
            {metrics.map((metric) => (
              <ComparisonChart
                key={metric.label}
                title={metric.label}
                currency={metric.label.includes("contribution")}
                points={[
                  {
                    id: "before",
                    label: "Current setup",
                    mean: experiment.runBeforeChanged
                      ? metric.after
                      : metric.before,
                    low: experiment.runBeforeChanged
                      ? metric.after
                      : metric.before,
                    high: experiment.runBeforeChanged
                      ? metric.after
                      : metric.before,
                  },
                  {
                    id: "after",
                    label: "Changed setup",
                    mean: changed ? metric.after : metric.before,
                    low: changed ? metric.after : metric.before,
                    high: changed ? metric.after : metric.before,
                  },
                ]}
              />
            ))}
          </div>
          <table className={styles.table}>
            <caption className="sr-only">
              Illustrative before and after metrics
            </caption>
            <thead>
              <tr>
                <th>Metric</th>
                <th>Current</th>
                <th>Changed</th>
              </tr>
            </thead>
            <tbody>
              {metrics.map((metric) => (
                <tr key={metric.label}>
                  <th>{metric.label}</th>
                  <td>
                    {experiment.runBeforeChanged ? metric.after : metric.before}
                  </td>
                  <td>{changed ? metric.after : metric.before}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : (
        <p className={styles.muted}>Adjust a control, then run the sample.</p>
      )}
    </section>
  );
}

type CashState = { mode: string; accountId: string; buildout: string };
const initialCash: CashState = {
  mode: "demo",
  accountId: accounts[0].id,
  buildout: "80000",
};
function CashPanel({
  contribution,
  state,
  onChange,
}: {
  contribution: { mean: number; low: number; high: number };
  state: CashState;
  onChange: (state: CashState) => void;
}) {
  const { mode, accountId, buildout } = state;
  const setMode = (mode: string) => onChange({ ...state, mode });
  const setAccount = (accountId: string) => onChange({ ...state, accountId });
  const setBuildout = (buildout: string) => onChange({ ...state, buildout });
  const account = accounts.find((entry) => entry.id === accountId)!;
  let projection: ReturnType<typeof projectCashBuffer> | null = null,
    error: string | null = null;
  try {
    projection = projectCashBuffer(
      account.availableCents,
      upfrontCostCents(buildout),
      contribution,
    );
  } catch {
    error = "Enter a valid upfront cost.";
  }
  return (
    <section className={styles.panel} aria-label="Cash review">
      <h2>Cash buffer</h2>
      <p className={styles.muted}>
        Nessie simulated banking · sample accounts · no bank connection
      </p>
      <label className="mt-5 block text-xs">
        Connection state
        <select
          className={`${styles.select} ml-3`}
          value={mode}
          onChange={(event) => setMode(event.target.value)}
        >
          <option value="demo">Sample accounts</option>
          <option value="unconfigured">Not configured</option>
          <option value="empty">No accounts</option>
          <option value="error">Service error</option>
        </select>
      </label>
      {mode !== "demo" ? (
        <div className={styles.state} role="status">
          <h3>
            {mode === "unconfigured"
              ? "Nessie not configured"
              : mode === "empty"
                ? "No simulated accounts"
                : "Cash service unavailable"}
          </h3>
          <button
            className={`${styles.button} mt-4`}
            onClick={() => setMode("demo")}
          >
            Return to sample accounts
          </button>
        </div>
      ) : (
        <>
          <div className={styles.controls}>
            <label>
              Demo account
              <select
                value={accountId}
                onChange={(event) => setAccount(event.target.value)}
              >
                {accounts.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.nickname}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Upfront buildout / $
              <input
                inputMode="decimal"
                value={buildout}
                onChange={(event) => setBuildout(event.target.value)}
              />
            </label>
          </div>
          {error ? (
            <p role="alert">{error}</p>
          ) : (
            projection && (
              <>
                <ComparisonChart
                  title="Cash / illustrative one-month view"
                  currency
                  points={[
                    {
                      id: "available",
                      label: "Available cash",
                      mean: account.availableCents / 100,
                      low: account.availableCents / 100,
                      high: account.availableCents / 100,
                    },
                    {
                      id: "upfront",
                      label: "Upfront buildout",
                      mean: -upfrontCostCents(buildout) / 100,
                      low: -upfrontCostCents(buildout) / 100,
                      high: -upfrontCostCents(buildout) / 100,
                    },
                    {
                      id: "projected",
                      label: "Cash after 1 month",
                      mean: projection.cashAfterOneMonthCents.mean / 100,
                      low: projection.cashAfterOneMonthCents.low / 100,
                      high: projection.cashAfterOneMonthCents.high / 100,
                    },
                  ]}
                />
                <p className="mt-6 text-sm">
                  Projected cash{" "}
                  {money(projection.cashAfterOneMonthCents.mean / 100)}
                </p>
                <p className={styles.muted}>
                  {projection.coverage.kind === "depleted"
                    ? "Upfront cost uses the available cash."
                    : projection.coverage.kind === "burning"
                      ? `${projection.coverage.months.toFixed(1)} months of modeled loss coverage.`
                      : "No operating loss in this sample."}
                </p>
              </>
            )
          )}
        </>
      )}
    </section>
  );
}

export function ClientFlowReview() {
  const [stage, setStage] = useState<Stage>("Property"),
    [selectedId, setSelected] = useState(reviewProperties[0].candidate.id),
    [compareIds, setCompare] = useState(reviewMetrics.map((entry) => entry.id));
  const [mode, setMode] = useState<"Text" | "Voice">("Text"),
    [draft, setDraft] = useState(""),
    [messages, setMessages] = useState<Message[]>([]),
    [scan, setScan] = useState(false),
    [selectedStation, setSelectedStation] = useState(0),
    [previewState, setPreviewState] = useState("ready");
  const [experiments, setExperiments] = useState<Record<string, Experiment>>(
    {},
  );
  const [cash, setCash] = useState<CashState>(initialCash);
  const selected = reviewProperties.find(
    (entry) => entry.candidate.id === selectedId,
  )!;
  const metric =
    reviewMetrics.find((entry) => entry.id === selected.propertyId) ??
    reviewMetrics[0];
  const index = stages.indexOf(stage);
  function go(next: Stage) {
    setStage(next);
    setPreviewState("ready");
  }
  function select(id: string) {
    setSelected(id);
    go("Property");
  }
  function experiment(kind: "Outdoor" | "Indoor") {
    const key = `${selectedId}:${kind}`;
    return (
      <ExperimentPanel
        kind={kind}
        experiment={experiments[key] ?? initialExperiment()}
        onChange={(next) =>
          setExperiments((current) => ({ ...current, [key]: next }))
        }
        onInterior={() => go("Interior")}
      />
    );
  }
  function send(event: FormEvent) {
    event.preventDefault();
    if (!draft.trim()) return;
    setMessages((current) => [
      ...current,
      { role: "user", text: draft.trim() },
      {
        role: "scripted",
        text: `${selected.candidate.address} · ${stage}. This review uses fixed sample figures; controls and selection stay in this tab.`,
      },
    ]);
    setDraft("");
  }
  return (
    <WorkspaceShell
      header={{
        city: "Houston",
        business: "Coffee shop",
        budget: "Sample rent limit $4,500",
        budgetIsDefault: false,
      }}
      projectId="client-flow-review"
      editBriefHref={null}
      navigation={<span>Sample data · Review only</span>}
      assistant={
        <aside
          className={`${styles.panel} ${styles.chat}`}
          aria-label="Review consultant"
        >
          <nav role="tablist" aria-label="Review chat mode">
            {(["Text", "Voice"] as const).map((value) => (
              <button
                key={value}
                className={`${styles.button} ${mode === value ? styles.primary : ""}`}
                role="tab"
                aria-selected={mode === value}
                onClick={() => setMode(value)}
                onKeyDown={(event) => {
                  if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
                    event.preventDefault();
                    setMode(mode === "Text" ? "Voice" : "Text");
                  }
                }}
              >
                {value}
              </button>
            ))}
          </nav>
          <p className={styles.muted}>Scripted review · no live agent calls</p>
          {mode === "Voice" && (
            <div className="my-4 text-center">
              <div className="mx-auto h-40 w-40">
                <GradientOrb active={false} reducedMotion />
              </div>
              <p className="mt-4 text-sm">Voice unavailable in review</p>
              <button className={`${styles.button} mt-3`} disabled>
                Start voice
              </button>
            </div>
          )}
          <div
            role="log"
            aria-label="Review conversation"
            className={styles.log}
          >
            <ol>
              {messages.map((message, index) => (
                <li key={index} data-role={message.role}>
                  <small>
                    {message.role === "user" ? "You" : "Scripted reply"}
                  </small>
                  {message.text}
                </li>
              ))}
            </ol>
          </div>
          {mode === "Text" && (
            <form onSubmit={send} className={styles.composer}>
              <input
                aria-label="Review message"
                placeholder="Ask about this sample…"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
              />
              <button className={styles.button} disabled={!draft.trim()}>
                Send
              </button>
            </form>
          )}
        </aside>
      }
    >
      <div className={styles.flow}>
        <header className={styles.top}>
          <nav className={styles.nav} aria-label="Review stages">
            {stages.map((value) => (
              <button
                key={value}
                aria-pressed={stage === value}
                onClick={() => go(value)}
              >
                {value}
              </button>
            ))}
          </nav>
          <label className={styles.muted}>
            Preview state{" "}
            <select
              className={styles.select}
              aria-label="Preview state"
              value={previewState}
              onChange={(event) => setPreviewState(event.target.value)}
            >
              <option value="ready">Ready</option>
              <option value="loading">Loading</option>
              <option value="error">Error</option>
            </select>
          </label>
        </header>
        <div className={styles.top}>
          <span className={styles.muted}>{selected.candidate.address}</span>
          <div className={styles.nav}>
            <button
              disabled={index === 0}
              onClick={() => go(stages[index - 1])}
            >
              Back
            </button>
            <button
              disabled={index === stages.length - 1}
              onClick={() => go(stages[index + 1])}
            >
              Next
            </button>
            <button
              onClick={() => {
                setStage("Property");
                setSelected(reviewProperties[0].candidate.id);
                setCompare(reviewMetrics.map((entry) => entry.id));
                setExperiments({});
                setMessages([]);
                setDraft("");
                setMode("Text");
                setScan(false);
                setSelectedStation(0);
                setCash({ ...initialCash });
                setPreviewState("ready");
              }}
            >
              Reset review
            </button>
          </div>
        </div>
        <details id="brief" className={styles.muted}>
          <summary>Sample brief</summary>
          <p className="mt-2">
            Houston · Coffee shop · $4,500 monthly rent limit · $80,000
            buildout. Decorative city background; locations and layouts are
            illustrative.
          </p>
        </details>
        {previewState !== "ready" ? (
          <section
            className={styles.panel}
            role={previewState === "error" ? "alert" : "status"}
          >
            <h2>
              {previewState === "loading"
                ? "Loading sample preview"
                : "Sample error state"}
            </h2>
            <button
              className={`${styles.button} mt-4`}
              onClick={() => setPreviewState("ready")}
            >
              {previewState === "error" ? "Retry sample" : "Show sample result"}
            </button>
          </section>
        ) : (
          <>
            {stage === "Property" && (
              <>
                <div
                  className={styles.cards}
                  aria-label="Sample property choices"
                >
                  {reviewProperties
                    .filter((entry) => entry.candidate.id === entry.propertyId)
                    .map((entry) => (
                      <button
                        key={entry.candidate.id}
                        aria-pressed={selected.propertyId === entry.propertyId}
                        onClick={() => select(entry.candidate.id)}
                      >
                        <strong>{entry.candidate.address}</strong>
                        <span>
                          {money(entry.baseRentCents.value! / 100)}/mo ·{" "}
                          {entry.candidate.floorAreaSqFt.value?.toLocaleString()}{" "}
                          sq ft
                        </span>
                      </button>
                    ))}
                </div>
                <div className="flex min-h-0">
                  <PropertyDetails
                    selected={selected}
                    candidates={reviewProperties}
                    projectId="client-flow-review"
                    onSelect={select}
                    onClose={() => go("Compare")}
                    onInterior={() => go("Interior")}
                    onCompare={() => go("Compare")}
                    fullDetailsHref={null}
                  />
                </div>
              </>
            )}
            {stage === "Compare" && (
              <section
                className={styles.panel}
                aria-label="Review location comparison"
              >
                <h2>Compare locations</h2>
                <p className={styles.muted}>
                  Illustrative modeled ranges · not observed traffic
                </p>
                <div className={`${styles.cards} my-5`}>
                  {reviewMetrics.map((entry) => (
                    <label key={entry.id} className="text-xs">
                      <input
                        type="checkbox"
                        checked={compareIds.includes(entry.id)}
                        onChange={(event) =>
                          setCompare((ids) =>
                            event.target.checked
                              ? [...ids, entry.id]
                              : ids.filter((id) => id !== entry.id),
                          )
                        }
                      />{" "}
                      {
                        reviewProperties.find(
                          (site) => site.candidate.id === entry.id,
                        )!.candidate.address
                      }
                    </label>
                  ))}
                </div>
                {compareIds.length < 2 ? (
                  <p role="status">Select at least two locations.</p>
                ) : (
                  <>
                    <div className={styles.grid}>
                      {(["customers", "contribution"] as const).map((key) => (
                        <ComparisonChart
                          key={key}
                          title={
                            key === "customers"
                              ? "Customers / month"
                              : "Operating contribution / month"
                          }
                          currency={key === "contribution"}
                          points={reviewMetrics
                            .filter((entry) => compareIds.includes(entry.id))
                            .map((entry) => ({
                              id: entry.id,
                              label: reviewProperties.find(
                                (site) => site.candidate.id === entry.id,
                              )!.candidate.address,
                              ...entry[key],
                            }))}
                        />
                      ))}
                    </div>
                    <table className={styles.table}>
                      <caption className="sr-only">
                        Sample listing facts and modeled figures
                      </caption>
                      <thead>
                        <tr>
                          <th>Location</th>
                          <th>Asking rent</th>
                          <th>Customers / mo</th>
                          <th>Contribution / mo</th>
                        </tr>
                      </thead>
                      <tbody>
                        {reviewMetrics
                          .filter((entry) => compareIds.includes(entry.id))
                          .map((entry) => {
                            const site = reviewProperties.find(
                              (site) => site.candidate.id === entry.id,
                            )!;
                            return (
                              <tr key={entry.id}>
                                <th>
                                  <button
                                    className="underline"
                                    onClick={() => select(entry.id)}
                                  >
                                    {site.candidate.address}
                                  </button>
                                </th>
                                <td>
                                  {money(site.baseRentCents.value! / 100)}
                                </td>
                                <td>{entry.customers.mean}</td>
                                <td>{money(entry.contribution.mean)}</td>
                              </tr>
                            );
                          })}
                      </tbody>
                    </table>
                  </>
                )}
                <button
                  className={`${styles.button} ${styles.primary} mt-5`}
                  onClick={() => go("Outdoor")}
                >
                  Try an outdoor experiment
                </button>
              </section>
            )}
            {stage === "Outdoor" && experiment("Outdoor")}
            {stage === "Interior" && (
              <section className={styles.panel} aria-label="Interior review">
                <h2>Interior</h2>
                <p className={styles.muted}>{selected.candidate.address}</p>
                <div className={styles.actions}>
                  <button
                    className={styles.button}
                    aria-pressed={!scan}
                    onClick={() => setScan(false)}
                  >
                    Scan availability
                  </button>
                  <button
                    className={styles.button}
                    aria-pressed={scan}
                    onClick={() => setScan(true)}
                  >
                    Illustrative floor plan
                  </button>
                </div>
                {scan ? (
                  <Schematic
                    stations={initialSetup.stations}
                    selected={selectedStation}
                    onSelect={setSelectedStation}
                  />
                ) : (
                  <div className={styles.state} role="status">
                    <h3>No verified scan in this review</h3>
                    <p className={`${styles.muted} mt-2`}>
                      No Matterport model is attached to these sample
                      properties.
                    </p>
                  </div>
                )}
                <div className={styles.actions}>
                  <button
                    className={`${styles.button} ${styles.primary}`}
                    onClick={() => go("Indoor")}
                  >
                    Test indoor capacity
                  </button>
                  <button
                    className={styles.button}
                    onClick={() => go("Property")}
                  >
                    Back to property
                  </button>
                </div>
              </section>
            )}
            {stage === "Indoor" && experiment("Indoor")}
            {stage === "Cash" && (
              <CashPanel
                contribution={metric.contribution}
                state={cash}
                onChange={setCash}
              />
            )}
          </>
        )}
      </div>
    </WorkspaceShell>
  );
}
