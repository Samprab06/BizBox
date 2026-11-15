/**
 * HAC-91: copilot guardrails. Extends the HAC-24 no-invented-numbers rule to chat: a
 * number in model-authored text must be grounded in something the model was actually
 * given (the founder's own words, tool arguments and verified tool outputs, the
 * workspace clock, or values a caller resolved from issued references). Anything else
 * is stripped and flagged; the turn is not retried.
 *
 * Pure: no model, database or provider calls.
 */

export const REMOVED_NUMBER = "[unverified number removed]";
export const REMOVED_NOTICE =
  "Some numbers were removed because they did not match a verified result.";

export type NumberToken = {
  /** The exact matched text, for example "$7.50", "10%", "6am" or "6:30". */
  text: string;
  index: number;
  /** Equivalent readings; the token is grounded when any of them is. */
  readings: number[];
};

// Digits not glued to identifiers ("scenario-3", "s1", "v2.1"), with optional
// currency, thousands separators, decimals, clock times and unit suffixes.
const NUMBER =
  /(?<![\w.$-])(\$)?(?:(\d{1,2}):(\d{2})|(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?)(?:\s?(am|pm|%|k|st|nd|rd|th)\b|(%))?(?![\w%])/gi;
/** "1. " or "2) " list markers at the start of a line are structure, not claims. */
const LIST_MARKER = /^[ \t]*$/;

function hour24(hour: number, meridiem: string) {
  if (meridiem === "am") return hour === 12 ? 0 : hour;
  return hour === 12 ? 12 : hour + 12;
}

export function extractNumbers(text: string): NumberToken[] {
  const tokens: NumberToken[] = [];
  for (const match of text.matchAll(NUMBER)) {
    const [whole, dollar, clockHour, clockMinute, integer, fraction] = match;
    const suffix = (match[6] ?? match[7] ?? "").toLowerCase();
    const index = match.index;
    const lineStart = text.lastIndexOf("\n", index - 1) + 1;
    const after = text.slice(index + whole.length, index + whole.length + 2);
    if (
      LIST_MARKER.test(text.slice(lineStart, index)) &&
      /^[.)]\s/.test(after) &&
      !dollar &&
      !suffix
    )
      continue;
    const readings: number[] = [];
    if (clockHour !== undefined) {
      let hour = Number(clockHour);
      if (suffix === "am" || suffix === "pm") hour = hour24(hour, suffix);
      const minutes = hour * 60 + Number(clockMinute);
      readings.push(minutes);
      if (clockMinute === "00") readings.push(hour);
    } else {
      const value = Number(
        `${integer.replaceAll(",", "")}${fraction ? `.${fraction}` : ""}`,
      );
      if (suffix === "am" || suffix === "pm") {
        const hour = hour24(value, suffix);
        readings.push(hour, hour * 60);
      } else if (suffix === "%") readings.push(value, value / 100);
      else if (suffix === "k") readings.push(value * 1000);
      else readings.push(value);
      if (dollar) readings.push(Math.round(value * 100));
    }
    tokens.push({ text: whole, index, readings });
  }
  return tokens;
}

/** Keys whose values are minutes since midnight; their whole hours are grounded too. */
const MINUTE_KEY = /(?:^|_)(?:open|close)$|minutes?$|min$/i;
/** Keys in cents; the dollar amount is grounded too. */
const CENTS_KEY = /cents$/i;

/**
 * Every number a reply may repeat. Strings contribute the numbers written in them, so
 * pass only trusted text here (founder messages, never earlier model replies).
 */
export function groundedNumbers(sources: readonly unknown[]): Set<number> {
  const out = new Set<number>();
  const add = (value: number) => {
    if (Number.isFinite(value)) out.add(value);
  };
  const walk = (value: unknown, key: string, depth: number) => {
    if (depth > 20) return;
    if (typeof value === "number") {
      add(value);
      if (MINUTE_KEY.test(key) && Number.isInteger(value)) {
        if (value % 60 === 0) add(value / 60);
        add(Math.floor(value / 60));
      }
      if (CENTS_KEY.test(key)) add(value / 100);
    } else if (typeof value === "string") {
      for (const token of extractNumbers(value)) token.readings.forEach(add);
    } else if (Array.isArray(value)) {
      for (const item of value) walk(item, key, depth + 1);
    } else if (value && typeof value === "object") {
      for (const [k, v] of Object.entries(value)) walk(v, k, depth + 1);
    }
  };
  for (const source of sources) walk(source, "", 0);
  return out;
}

function isGrounded(token: NumberToken, grounded: ReadonlySet<number>) {
  return token.readings.some((reading) => {
    if (grounded.has(reading)) return true;
    for (const value of grounded)
      if (Math.abs(value - reading) <= 1e-9 * Math.max(1, Math.abs(value)))
        return true;
    return false;
  });
}

export type GuardedText = { text: string; removed: string[] };

/** Strips every ungrounded number and reports what was removed. */
export function guardCopilotText(
  text: string,
  grounded: ReadonlySet<number>,
): GuardedText {
  const removed: string[] = [];
  let out = "";
  let cursor = 0;
  for (const token of extractNumbers(text)) {
    if (isGrounded(token, grounded)) continue;
    removed.push(token.text);
    out += text.slice(cursor, token.index) + REMOVED_NUMBER;
    cursor = token.index + token.text.length;
  }
  return { text: out + text.slice(cursor), removed };
}

/** Guards one model reply and its findings against the same grounded set. */
export function guardCopilotDecision(
  decision: { reply: string; findings: readonly string[] },
  grounded: ReadonlySet<number>,
) {
  const reply = guardCopilotText(decision.reply, grounded);
  const findings = decision.findings.map((f) => guardCopilotText(f, grounded));
  const removed = [...reply.removed, ...findings.flatMap((f) => f.removed)];
  return {
    reply:
      reply.removed.length && reply.text.trim()
        ? `${reply.text} (${REMOVED_NOTICE})`
        : reply.text,
    findings: findings.map((f) => f.text),
    removed,
  };
}

/** Field names a model might use to self-approve. Tool schemas are strict, so such
 * arguments are rejected; this list lets callers report it explicitly. */
const APPROVAL_KEYS =
  /^(?:confirm|confirmed|confirmBudget|budgetConfirmed|runConfirmed|approved|approval|consent|authorized|authorization|override)$/i;

/** Approval-shaped keys anywhere in model-authored tool arguments. */
export function modelApprovalKeys(args: unknown): string[] {
  const found: string[] = [];
  const walk = (value: unknown, depth: number) => {
    if (depth > 20 || !value || typeof value !== "object") return;
    for (const [key, entry] of Object.entries(value)) {
      if (APPROVAL_KEYS.test(key)) found.push(key);
      walk(entry, depth + 1);
    }
  };
  walk(args, 0);
  return found;
}
