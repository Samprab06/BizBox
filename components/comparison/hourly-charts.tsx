import { hourLabel, type SiteHours } from "./hourly-overlay";

/** One color and dash pattern per shortlisted site, so lines differ without relying on color. */
const series = [
  { color: "#1b4937", dash: undefined },
  { color: "#b5653a", dash: "6 4" },
  { color: "#4f6fa8", dash: "2 3" },
  { color: "#8a5a9e", dash: "8 3 2 3" },
] as const;
const styleFor = (index: number) => series[index % series.length];

/** Bars of hourly arrivals with the hourly service capacity drawn as a step line. */
export function PeakSparkline({ data }: { data: SiteHours }) {
  const width = 112;
  const height = 32;
  const { hours, peakHour } = data;
  const max = Math.max(
    1,
    ...hours.map((h) => Math.max(h.arrivals, h.capacity ?? 0)),
  );
  const step = width / Math.max(1, hours.length);
  const y = (value: number) => height - (value / max) * (height - 2);
  const capacity = hours.every((h) => h.capacity !== null)
    ? hours
        .map((h, i) => {
          const top = y(h.capacity as number).toFixed(1);
          return `${i === 0 ? "M" : "L"}${(i * step).toFixed(1)} ${top} H${((i + 1) * step).toFixed(1)}`;
        })
        .join(" ")
    : null;
  const peak = hours.find((h) => h.hour === peakHour);
  const summary = peak
    ? `Peak ${hourLabel(peak.hour)}: ${peak.arrivals} arrivals${peak.capacity !== null ? ` vs capacity ${Math.round(peak.capacity)}` : ""}`
    : "No arrivals";

  return (
    <figure className="m-0">
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`Hourly arrivals vs capacity, run ${data.runId}. ${summary}.`}
        data-run-id={data.runId}
      >
        {hours.map((h, i) => (
          <rect
            key={h.hour}
            x={i * step + 1}
            y={y(h.arrivals)}
            width={Math.max(1, step - 2)}
            height={height - y(h.arrivals)}
            rx={1}
            fill={h.hour === peakHour ? "#1b4937" : "#9fb3a6"}
          />
        ))}
        {capacity && (
          <path
            d={capacity}
            fill="none"
            stroke="#b5653a"
            strokeWidth={1.5}
            strokeDasharray="3 2"
          />
        )}
      </svg>
      <figcaption className="mt-1 text-xs text-muted">{summary}</figcaption>
    </figure>
  );
}

/** Hourly p90 wait of each site's representative run, overlaid on one chart. */
export function WaitOverlayChart({
  sites,
}: {
  sites: { label: string; data: SiteHours }[];
}) {
  const width = 640;
  const height = 220;
  const pad = { left: 40, right: 16, top: 12, bottom: 28 };
  const hours = [
    ...new Set(sites.flatMap(({ data }) => data.hours.map((h) => h.hour))),
  ].sort((a, b) => a - b);
  const top = Math.max(
    5,
    Math.ceil(
      Math.max(
        0,
        ...sites.flatMap(({ data }) =>
          data.hours.map((h) => h.p90WaitMin ?? 0),
        ),
      ) / 5,
    ) * 5,
  );
  const x = (hour: number) =>
    pad.left +
    (hours.length > 1
      ? (hours.indexOf(hour) / (hours.length - 1)) *
        (width - pad.left - pad.right)
      : (width - pad.left - pad.right) / 2);
  const y = (minutes: number) =>
    pad.top + (1 - minutes / top) * (height - pad.top - pad.bottom);
  const ticks = [0, top / 2, top];

  // Break the line wherever an hour has no served customers to measure.
  const pathFor = (data: SiteHours) => {
    let d = "";
    let pen = false;
    for (const h of data.hours) {
      if (h.p90WaitMin === null) {
        pen = false;
        continue;
      }
      d += `${pen ? "L" : "M"}${x(h.hour).toFixed(1)} ${y(h.p90WaitMin).toFixed(1)} `;
      pen = true;
    }
    return d.trim();
  };

  return (
    <figure className="m-0">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-auto w-full"
        role="img"
        aria-labelledby="wait-overlay-title"
      >
        <title id="wait-overlay-title">
          Hourly p90 wait by site, representative weekday runs
        </title>
        {ticks.map((tick) => (
          <g key={tick}>
            <line
              x1={pad.left}
              x2={width - pad.right}
              y1={y(tick)}
              y2={y(tick)}
              stroke="#d9dfd5"
            />
            <text
              x={pad.left - 8}
              y={y(tick) + 4}
              textAnchor="end"
              fontSize={11}
              fill="#50655a"
            >
              {tick}m
            </text>
          </g>
        ))}
        {hours.map((hour) => (
          <text
            key={hour}
            x={x(hour)}
            y={height - 8}
            textAnchor="middle"
            fontSize={11}
            fill="#50655a"
          >
            {hourLabel(hour)}
          </text>
        ))}
        {sites.map(({ data }, index) => {
          const { color, dash } = styleFor(index);
          return (
            <g key={data.siteId} data-run-id={data.runId}>
              <path
                d={pathFor(data)}
                fill="none"
                stroke={color}
                strokeWidth={2}
                strokeDasharray={dash}
                strokeLinejoin="round"
              />
              {data.hours.map(
                (h) =>
                  h.p90WaitMin !== null && (
                    <circle
                      key={h.hour}
                      cx={x(h.hour)}
                      cy={y(h.p90WaitMin)}
                      r={2.5}
                      fill={color}
                    />
                  ),
              )}
            </g>
          );
        })}
      </svg>
      <figcaption>
        <ul className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted">
          {sites.map(({ label, data }, index) => {
            const { color, dash } = styleFor(index);
            return (
              <li key={data.siteId} className="flex items-center gap-2">
                <svg width="20" height="6" aria-hidden>
                  <line
                    x1="0"
                    x2="20"
                    y1="3"
                    y2="3"
                    stroke={color}
                    strokeWidth="2"
                    strokeDasharray={dash}
                  />
                </svg>
                {label}
              </li>
            );
          })}
        </ul>
      </figcaption>
      {/* The wrapper clips the text-alternative table. sr-only on the table itself
          does not clip its rows in browsers, which widened the page at phone width. */}
      <div className="sr-only">
        <table>
          <caption>Hourly p90 wait in minutes</caption>
          <thead>
            <tr>
              <th scope="col">Hour</th>
              {sites.map(({ label, data }) => (
                <th key={data.siteId} scope="col">
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {hours.map((hour) => (
              <tr key={hour}>
                <th scope="row">{hourLabel(hour)}</th>
                {sites.map(({ data }) => {
                  const value = data.hours.find(
                    (h) => h.hour === hour,
                  )?.p90WaitMin;
                  return (
                    <td key={data.siteId}>
                      {value === null || value === undefined
                        ? "No served customers"
                        : value.toFixed(1)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  );
}
