import { Fragment, type ReactNode } from "react";

/**
 * HAC-173: a tiny, safe markdown subset for assistant replies: **bold**, *italic*, `code`,
 * line breaks and simple lists. It builds React elements only (never raw HTML), so any
 * markup in model output renders as text.
 */

type Block =
  | { kind: "p"; lines: string[] }
  | { kind: "ul" | "ol"; items: string[] };

export function parseBlocks(source: string): Block[] {
  const blocks: Block[] = [];
  for (const line of source.replace(/\r\n?/g, "\n").split("\n")) {
    const bullet = /^\s*[-*•]\s+(.*)$/.exec(line);
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    const item = bullet ?? numbered;
    const kind = bullet ? "ul" : "ol";
    const last = blocks[blocks.length - 1];
    if (item) {
      if (last && last.kind === kind) last.items.push(item[1]!);
      else blocks.push({ kind, items: [item[1]!] });
    } else if (line.trim() === "") {
      if (last && last.kind === "p" && last.lines.length > 0) {
        blocks.push({ kind: "p", lines: [] });
      }
    } else if (last && last.kind === "p") {
      last.lines.push(line);
    } else {
      blocks.push({ kind: "p", lines: [line] });
    }
  }
  return blocks.filter((b) => (b.kind === "p" ? b.lines.length > 0 : true));
}

const INLINE = /(`[^`\n]+`)|(\*\*[^*\n]+?\*\*)|(\*[^*\s][^*\n]*?\*)/;

export function renderInline(text: string, keyPrefix = "i"): ReactNode[] {
  const out: ReactNode[] = [];
  let rest = text;
  let n = 0;
  while (rest) {
    const match = INLINE.exec(rest);
    if (!match) {
      out.push(rest);
      break;
    }
    if (match.index > 0) out.push(rest.slice(0, match.index));
    const key = `${keyPrefix}-${n++}`;
    const token = match[0];
    if (match[1]) {
      out.push(
        <code key={key} className="rounded bg-black/10 px-1 font-mono text-[0.9em]">
          {token.slice(1, -1)}
        </code>,
      );
    } else if (match[2]) {
      out.push(<strong key={key}>{renderInline(token.slice(2, -2), key)}</strong>);
    } else {
      out.push(<em key={key}>{renderInline(token.slice(1, -1), key)}</em>);
    }
    rest = rest.slice(match.index + token.length);
  }
  return out;
}

export function Markdown({ text, className }: { text: string; className?: string }) {
  return (
    <div className={className} data-markdown>
      {parseBlocks(text).map((block, index) => {
        if (block.kind === "p") {
          return (
            <p key={index} className={index > 0 ? "mt-2" : undefined}>
              {block.lines.map((line, i) => (
                <Fragment key={i}>
                  {i > 0 && <br />}
                  {renderInline(line, `${index}-${i}`)}
                </Fragment>
              ))}
            </p>
          );
        }
        const List = block.kind;
        return (
          <List
            key={index}
            className={`${index > 0 ? "mt-2 " : ""}ml-5 ${block.kind === "ul" ? "list-disc" : "list-decimal"}`}
          >
            {block.items.map((item, i) => (
              <li key={i}>{renderInline(item, `${index}-${i}`)}</li>
            ))}
          </List>
        );
      })}
    </div>
  );
}
