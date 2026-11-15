"use client";
export type ComparisonPoint = {
  id: string;
  label: string;
  mean: number;
  low: number;
  high: number;
};
export function comparisonScale(
  values: readonly Pick<ComparisonPoint, "mean" | "low" | "high">[],
) {
  const finite = values
    .flatMap((value) => [value.mean, value.low, value.high])
    .filter(Number.isFinite);
  let min = Math.min(0, ...finite),
    max = Math.max(0, ...finite);
  if (min === max) {
    min = -1;
    max = 1;
  }
  const position = (value: number) =>
    Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100));
  return { zero: position(0), position };
}
export function ComparisonChart({
  title,
  points,
  currency = false,
}: {
  title: string;
  points: readonly ComparisonPoint[];
  currency?: boolean;
}) {
  const scale = comparisonScale(points);
  const format = (value: number) =>
    value.toLocaleString(
      "en-US",
      currency
        ? { style: "currency", currency: "USD", maximumFractionDigits: 0 }
        : { maximumFractionDigits: 1 },
    );
  return (
    <figure className="min-w-0">
      <figcaption className="mb-4 text-sm font-medium">{title}</figcaption>
      <div className="space-y-5">
        {points.map((point) => {
          const value = scale.position(point.mean),
            low = scale.position(Math.min(point.low, point.high)),
            high = scale.position(Math.max(point.low, point.high));
          return (
            <div key={point.id}>
              <div className="mb-2 flex justify-between gap-3 text-xs">
                <span>{point.label}</span>
                <strong>{format(point.mean)}</strong>
              </div>
              <svg
                viewBox="0 0 100 9"
                preserveAspectRatio="none"
                className="h-7 w-full"
                aria-hidden="true"
              >
                <rect
                  x="0"
                  y="1"
                  width="100"
                  height="7"
                  rx="1"
                  fill="#ffffff0c"
                />
                <line
                  x1={scale.zero}
                  x2={scale.zero}
                  y1="0"
                  y2="9"
                  stroke="#ffffff80"
                  strokeWidth=".4"
                />
                <rect
                  x={Math.min(scale.zero, value)}
                  y="2"
                  width={Math.abs(value - scale.zero)}
                  height="5"
                  fill={point.mean < 0 ? "#baa99c" : "#dedee5"}
                  rx=".6"
                />
                <line
                  x1={low}
                  x2={high}
                  y1="4.5"
                  y2="4.5"
                  stroke="#999aa4"
                  strokeWidth=".6"
                />
                <line
                  x1={low}
                  x2={low}
                  y1="1"
                  y2="8"
                  stroke="#999aa4"
                  strokeWidth=".4"
                />
                <line
                  x1={high}
                  x2={high}
                  y1="1"
                  y2="8"
                  stroke="#999aa4"
                  strokeWidth=".4"
                />
              </svg>
              {point.low !== point.high && (
                <p className="mt-1 text-right text-[11px] opacity-70">
                  Range {format(point.low)} to {format(point.high)}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </figure>
  );
}

/** A shared range axis fitted to the returned intervals; zero is shown only in range. */
export function fittedComparisonScale(
  values: readonly Pick<ComparisonPoint, "mean" | "low" | "high">[],
) {
  const finite = values
    .flatMap((value) => [value.mean, value.low, value.high])
    .filter(Number.isFinite);
  const low = finite.length ? Math.min(...finite) : 0;
  const high = finite.length ? Math.max(...finite) : 1;
  const padding = (high - low || Math.abs(high) || 1) * 0.08;
  const min = low - padding,
    max = high + padding;
  const position = (value: number) =>
    Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100));
  return {
    min,
    max,
    position,
    zero: low <= 0 && high >= 0 ? position(0) : null,
  };
}
