import type { LocationStoryData } from "./location-data";
import { chatAt, chatSchedule } from "./timeline";

export const NESSIE_PROMPT = "Can I afford the higher rent in The Heights?";
export const NESSIE_WORK_MS = 6800;
/** Authored landing example, not a response from the banking API. */
export function nessieExample(data: LocationStoryData) {
  const cash = 32000;
  const setup = 9000;
  const reserveMonths = 3;
  const sites = data.sites.map((site) => ({
    id: site.id,
    name: site.name,
    rent: site.rent,
    reserve: site.rent * reserveMonths,
    remaining: cash - setup - site.rent * reserveMonths,
  }));
  const difference = Math.abs(sites[0].remaining - sites[1].remaining);
  const replies = [
    `The Heights leaves $${sites[1].remaining.toLocaleString("en-US")} after setup and a three-month rent reserve. Montrose preserves $${difference.toLocaleString("en-US")} more cash. Other operating costs still need a budget.`,
  ];
  return { cash, setup, reserveMonths, sites, difference, replies };
}
export function nessieSchedule(data: LocationStoryData) {
  const chat = chatSchedule(NESSIE_PROMPT, nessieExample(data).replies);
  return { ...chat, duration: chat.duration + NESSIE_WORK_MS };
}
export function nessieAt(
  data: LocationStoryData,
  elapsed: number,
  reduced: boolean,
) {
  const example = nessieExample(data);
  const schedule = nessieSchedule(data);
  const composing = chatAt(NESSIE_PROMPT, example.replies, elapsed, reduced);
  const answer = chatAt(
    NESSIE_PROMPT,
    example.replies,
    elapsed - NESSIE_WORK_MS,
    reduced,
  );
  const workTime = Math.max(0, elapsed - schedule.sentAt);
  const stage =
    reduced || answer.replyVisible
      ? "answer"
      : !composing.sent
        ? "prompt"
        : workTime < 1700
          ? "checking"
          : workTime < 4200
            ? "snapshot"
            : "comparison";
  return {
    ...composing,
    paragraphs: answer.paragraphs,
    replyVisible: answer.replyVisible,
    complete: answer.complete,
    stage,
    example,
  };
}
