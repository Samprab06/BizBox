import type { AssumedValue, Evidence } from "@/lib/contracts";
import type { SiteSearchResult } from "@/lib/contracts/sites";

export const evidenceAnchor = (id: string) =>
  `evidence-${encodeURIComponent(id)}`;
export const evidenceHref = (id: string) =>
  `#${encodeURIComponent(evidenceAnchor(id))}`;

export function Metric({ metric }: { metric: AssumedValue }) {
  const monthlyMoney = metric.unit === "USD cents/month";
  const unit = monthlyMoney ? "/ month" : metric.unit;
  const value =
    metric.value === null
      ? "Unknown"
      : monthlyMoney
        ? (metric.value / 100).toLocaleString("en-US", {
            style: "currency",
            currency: "USD",
            maximumFractionDigits: 2,
            minimumFractionDigits: 0,
          })
        : metric.value.toLocaleString("en-US", { maximumFractionDigits: 2 });
  return (
    <span>
      <a
        href={evidenceHref(metric.evidenceIds[0])}
        className="text-pine underline decoration-dotted underline-offset-4"
      >
        {value} {unit}{" "}
        <span className="text-xs text-muted">{metric.origin}</span>
      </a>
      {metric.value === null && (
        <span className="block text-sm font-normal text-muted">
          {metric.unknownReason}
        </span>
      )}
    </span>
  );
}

export function LiveEvidence({
  search,
  catchment = [],
}: {
  search: SiteSearchResult["evidence"];
  catchment?: Evidence[];
}) {
  return (
    <aside
      aria-label="Evidence"
      className="mt-8 grid grid-cols-1 gap-4 border-t border-line pt-5 text-sm break-words"
    >
      <h3 className="font-semibold">Evidence and limitations</h3>
      {search.map((entry) => (
        <div key={entry.id} id={evidenceAnchor(entry.id)} tabIndex={-1}>
          <p>
            <strong>{entry.origin}</strong> · {entry.description}
          </p>
          {entry.sources.map((source, index) => (
            <p key={index} className="text-muted">
              {source.dataset} · record {source.recordId} · {source.field}
            </p>
          ))}
          {entry.limitations.map((note) => (
            <p key={note} className="text-muted">
              {note}
            </p>
          ))}
        </div>
      ))}
      {catchment.map((entry) => (
        <div key={entry.id} id={evidenceAnchor(entry.id)} tabIndex={-1}>
          <p>
            <strong>{entry.origin}</strong> · {entry.sourceLabel} ·{" "}
            {entry.description}
          </p>
          {entry.sourceUrl && (
            <a
              href={safeSourceUrl(entry.sourceUrl)}
              className="text-pine underline"
            >
              Source URL
            </a>
          )}
          <p className="text-muted">
            Retrieved{" "}
            <time dateTime={entry.retrievedAt}>{entry.retrievedAt}</time>
            {entry.observedAt && (
              <>
                {" "}
                · Observed{" "}
                <time dateTime={entry.observedAt}>{entry.observedAt}</time>
              </>
            )}
          </p>
          {entry.sourceUrl?.startsWith("s3:") && (
            <p className="text-muted">{entry.sourceUrl}</p>
          )}
          {entry.limitations.map((note) => (
            <p key={note} className="text-muted">
              {note}
            </p>
          ))}
        </div>
      ))}
    </aside>
  );
}

function safeSourceUrl(value: string) {
  try {
    const url = new URL(value);
    return ["https:", "http:", "s3:"].includes(url.protocol)
      ? value
      : undefined;
  } catch {
    return undefined;
  }
}
