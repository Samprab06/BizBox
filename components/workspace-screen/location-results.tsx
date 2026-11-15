"use client";

import { focusRing, pressable, cn } from "@/components/ui/cn";
import type { LiveComparisonPayload } from "@/lib/client/live-comparison";
import {
  LONG_WAIT_MEAN_MIN,
  LONG_WAIT_HIGH_MIN,
} from "@/lib/client/final-plan";
import { siteDemandLabel } from "@/lib/evaluation/demand-label";
import {
  fittedComparisonScale,
  type ComparisonPoint,
} from "./comparison-chart";
import {
  areaText,
  listingNotes,
  notModeledUnits,
  rentText,
  unitAddress,
  type WorkspaceCandidate,
} from "./client-model";
import styles from "./workspace-glass.module.css";

const money = (n: number) =>
  n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
const count = (n: number) =>
  n.toLocaleString("en-US", { maximumFractionDigits: 0 });
const minutes = (n: number) => `${n.toFixed(1)} min`;

/** One chart, one fitted axis, and a stable row per location. No additional statistics. */
function SharedRangeChart({
  title,
  points,
  currency,
  onSelect,
  sectionLabel,
}: {
  title: string;
  points: ComparisonPoint[];
  currency?: boolean;
  onSelect: (id: string) => void;
  sectionLabel: string;
}) {
  const scale = fittedComparisonScale(points);
  const format = currency ? money : count;
  const rowHeight = 46;
  const plotHeight = points.length * rowHeight;
  const ticks = [scale.min, (scale.min + scale.max) / 2, scale.max];
  return (
    <figure className={styles.sharedChart} aria-label={title}>
      <figcaption>
        <span className={styles.reportChartTitle}>
          <span>
            {sectionLabel}
            <small>{title}</small>
          </span>
        </span>
        <span title="Dot shows the mean. Line spans the modeled low–high interval.">
          Mean · low–high range
        </span>
      </figcaption>
      <div className={styles.sharedChartGrid}>
        <div className={styles.chartLabels}>
          {points.map((point) => (
            <button
              key={point.id}
              type="button"
              className={cn(styles.chartStreet, focusRing, pressable)}
              onClick={() => onSelect(point.id)}
            >
              {point.label}
            </button>
          ))}
        </div>
        <svg
          className={styles.sharedPlot}
          viewBox={`0 0 100 ${plotHeight + 25}`}
          style={{ height: plotHeight + 25 }}
          preserveAspectRatio="none"
          role="img"
          aria-label={`${title}. ${points.map((p) => `${p.label}: mean ${p.mean}; low ${p.low}; high ${p.high}`).join(". ")}`}
        >
          <title>
            {title}: dots are means; horizontal lines are low–high intervals
          </title>
          {ticks.map((tick, i) => (
            <line
              key={i}
              x1={scale.position(tick)}
              x2={scale.position(tick)}
              y1="0"
              y2={plotHeight}
              stroke="currentColor"
              opacity=".1"
              strokeWidth=".4"
            />
          ))}
          {scale.zero !== null && (
            <line
              data-zero-baseline
              x1={scale.zero}
              x2={scale.zero}
              y1="0"
              y2={plotHeight}
              stroke="currentColor"
              opacity=".5"
              strokeDasharray="2 3"
              strokeWidth=".5"
            />
          )}
          {points.map((point, index) => {
            const y = index * rowHeight + rowHeight / 2;
            const low = scale.position(Math.min(point.low, point.high)),
              high = scale.position(Math.max(point.low, point.high));
            return (
              <g
                key={point.id}
                color={
                  currency && point.mean < 0
                    ? "var(--color-danger)"
                    : "currentColor"
                }
              >
                <line
                  x1={low}
                  x2={high}
                  y1={y}
                  y2={y}
                  stroke="currentColor"
                  strokeWidth="2"
                  opacity=".65"
                />
                <line
                  x1={low}
                  x2={low}
                  y1={y - 4}
                  y2={y + 4}
                  stroke="currentColor"
                  strokeWidth=".5"
                />
                <line
                  x1={high}
                  x2={high}
                  y1={y - 4}
                  y2={y + 4}
                  stroke="currentColor"
                  strokeWidth=".5"
                />
                <ellipse
                  cx={scale.position(point.mean)}
                  cy={y}
                  rx="1.15"
                  ry="3.5"
                  fill="currentColor"
                />
              </g>
            );
          })}
          <line
            x1="0"
            x2="100"
            y1={plotHeight + 1}
            y2={plotHeight + 1}
            stroke="currentColor"
            opacity=".3"
            strokeWidth=".5"
          />
        </svg>
        <div className={styles.chartValues}>
          {points.map((point) => (
            <div
              key={point.id}
              title={`Mean ${point.mean}; low ${point.low}; high ${point.high}`}
            >
              <strong
                className={
                  currency && point.mean < 0 ? styles.negativeMetric : undefined
                }
              >
                {format(point.mean)}
              </strong>
              <span>
                {format(point.low)}–{format(point.high)}
              </span>
            </div>
          ))}
        </div>
        <div className={styles.sharedAxis}>
          {ticks.map((tick, index) => (
            <span key={index}>{format(tick)}</span>
          ))}
        </div>
      </div>
    </figure>
  );
}

export function LocationResults({
  payload,
  candidates,
  onSelect,
  onChoose,
  framed = true,
}: {
  payload: LiveComparisonPayload;
  candidates: readonly WorkspaceCandidate[];
  onSelect: (id: string) => void;
  onChoose?: (id: string) => void;
  framed?: boolean;
}) {
  const notModeled = notModeledUnits(payload, candidates);
  const locations = payload.result.ranking.flatMap((id) => {
    const result = payload.result.sites.find((site) => site.siteId === id);
    if (!result) return [];
    const candidate = candidates.find((entry) => entry.candidate.id === id);
    return [
      {
        id,
        result,
        candidate,
        label: candidate ? unitAddress(candidate, candidates) : "Saved unit",
      },
    ];
  });
  const findings = payload.assembly?.findings ?? [];
  const defaultAssumptions = Object.values(
    payload.assembly?.assumptions ?? {},
  ).filter((value) => value.origin === "default").length;
  const sourceNotes = locations.flatMap(({ id, result, label, candidate }) => {
    const demand = siteDemandLabel(
      payload.result,
      result,
      payload.result.sites,
    );
    const notes = candidate ? listingNotes(candidate) : [];
    return demand || notes.length ? [{ id, label, demand, notes }] : [];
  });
  const jevFallback =
    payload.result.requestedDemandSource === "jev" &&
    payload.result.demandSource !== "jev";
  return (
    <section
      className={framed ? styles.comparison : undefined}
      aria-label="Location comparison results"
    >
      <section className={styles.reportZone} aria-label="Listing facts">
        <div className={styles.reportZoneHeading}>
          <div>
            <h3>Listing facts</h3>
          </div>
        </div>
        <dl className={styles.reportListings}>
          {locations.map(({ id, label, candidate }) => (
            <div key={id}>
              <dt>
                <button
                  className={cn(styles.resultsAddress, focusRing, pressable)}
                  onClick={() => onSelect(id)}
                >
                  {label}
                </button>
              </dt>
              <dd>
                <span>
                  Rent {candidate ? rentText(candidate) : "Unavailable"}
                </span>
                <span>
                  Size {candidate ? areaText(candidate) : "Unavailable"}
                </span>
              </dd>
            </div>
          ))}
        </dl>
      </section>
      <SharedRangeChart
        sectionLabel="Financial performance"
        title="Operating contribution / month"
        currency
        points={locations.map(({ id, label, result }) => ({
          id,
          label,
          ...result.monthlyContributionUsd,
        }))}
        onSelect={onSelect}
      />
      <SharedRangeChart
        sectionLabel="Customer demand"
        title="Customers served / month"
        points={locations.map(({ id, label, result }) => ({
          id,
          label,
          ...result.monthlyServedCustomers,
        }))}
        onSelect={onSelect}
      />
      <div
        className={styles.resultsTableWrap}
        data-agent-anchor="comparison_table"
      >
        <table className={styles.waitTable}>
          <caption>
            Operations &amp; choice
            <br />
            <small className={styles.reportSubline}>
              Weekday wait · modeled ranges
            </small>
          </caption>
          <thead>
            <tr>
              <th scope="col">Location</th>
              <th scope="col">Weekday wait</th>
              {onChoose && (
                <th scope="col">
                  <span className="sr-only">Choose a location</span>
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {locations.map(({ id, label, result, candidate }, index) => (
              <tr key={id}>
                <th scope="row">
                  <button
                    className={cn(styles.resultsAddress, focusRing, pressable)}
                    onClick={() => onSelect(id)}
                  >
                    {label}
                  </button>
                  {candidate && (
                    <span className={styles.listingInline}>
                      Rent {rentText(candidate)} · {areaText(candidate)}
                    </span>
                  )}
                </th>
                <td
                  title={`Mean ${result.weekdayMeanWaitMin.mean}; low ${result.weekdayMeanWaitMin.low}; high ${result.weekdayMeanWaitMin.high}`}
                >
                  <strong>{minutes(result.weekdayMeanWaitMin.mean)}</strong>
                  <span className={styles.metricRange}>
                    {minutes(result.weekdayMeanWaitMin.low)}–
                    {minutes(result.weekdayMeanWaitMin.high)}
                  </span>
                  {(result.weekdayMeanWaitMin.mean > LONG_WAIT_MEAN_MIN ||
                    result.weekdayMeanWaitMin.high >= LONG_WAIT_HIGH_MIN) && (
                    <span className={styles.waitWarning}>
                      Long wait · check capacity
                    </span>
                  )}
                </td>
                {onChoose && (
                  <td>
                    <button
                      className={
                        index === 0 ? styles.primary : styles.secondary
                      }
                      aria-label={`Create final plan for ${label}`}
                      onClick={() => onChoose(id)}
                    >
                      Create final plan
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {notModeled.length > 0 && (
        <ul className={styles.notModeled} aria-label="Units not modeled">
          {notModeled.map((unit) => (
            <li key={unit.id}>
              Not modeled: {unit.address} — {unit.reason}
            </li>
          ))}
        </ul>
      )}
      <details className={styles.resultsDetails}>
        <summary>Assumptions &amp; sources</summary>
        <dl className={styles.sourceFacts}>
          <div>
            <dt>Scope</dt>
            <dd>
              Modeled estimates, not measured traffic. Buildout amortization is
              separate.{payload.comparison?.synthetic && " Example inputs."}
            </dd>
          </div>
          {findings.some((finding) => finding.code === "UNKNOWN_PARKING") && (
            <div>
              <dt>Parking</dt>
              <dd>Unverified</dd>
            </div>
          )}
          {jevFallback && (
            <div>
              <dt>Fallback</dt>
              <dd>Jev unavailable; Huff used.</dd>
            </div>
          )}
          <div>
            <dt>Demand model</dt>
            <dd>
              {payload.result.demandSource === "jev"
                ? "Jev customer panel"
                : "Huff gravity fallback"}
              {payload.result.jevModelVersion
                ? ` · ${payload.result.jevModelVersion}`
                : ""}
            </dd>
          </div>
          <div>
            <dt>Input assumptions</dt>
            <dd>
              {defaultAssumptions
                ? `${defaultAssumptions} stored inputs use defaults. Their exact values and provenance are preserved in Technical details.`
                : "See the stored input values and provenance in Technical details."}
            </dd>
          </div>
          <div>
            <dt>Modeled economics</dt>
            <dd>
              Contribution includes operating costs. Buildout amortization is
              separate.
            </dd>
          </div>
          {sourceNotes.map(({ id, label, demand, notes }) => (
            <div key={id}>
              <dt>{label}</dt>
              <dd>
                {demand && <p>{demand}</p>}
                {notes.map((note) => (
                  <p key={note}>{note}</p>
                ))}
              </dd>
            </div>
          ))}
        </dl>
        <details className={styles.resultsDetails}>
          <summary>
            Technical details · full diagnostics ({findings.length})
          </summary>
          <pre className={styles.technicalDetails}>
            {JSON.stringify(
              {
                fallbackReason: payload.result.fallbackReason,
                jevModelVersion: payload.result.jevModelVersion,
                findings,
                assumptions: payload.assembly?.assumptions ?? {},
              },
              null,
              2,
            )}
          </pre>
        </details>
      </details>
    </section>
  );
}
