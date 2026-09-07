import {
  BASELINE_START_ISO,
  LATE_PREVIOUS_WEEK_KEYWORD,
} from "./config";

export const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
export const BASELINE_START_MS = Date.parse(BASELINE_START_ISO);

if (!Number.isFinite(BASELINE_START_MS)) {
  throw new Error(`잘못된 BASELINE_START_ISO: ${BASELINE_START_ISO}`);
}

export function getWeekIndexFromMs(timestampMs: number): number {
  return Math.floor((timestampMs - BASELINE_START_MS) / WEEK_MS);
}

export function getMessageWeekIndex(
  timestampIso: string,
  content: string,
): number {
  let weekIndex = getWeekIndexFromMs(Date.parse(timestampIso));

  if (content.includes(LATE_PREVIOUS_WEEK_KEYWORD)) {
    weekIndex -= 1;
  }

  return weekIndex;
}

export function getWeekStartMs(weekIndex: number): number {
  return BASELINE_START_MS + weekIndex * WEEK_MS;
}

export function getWeekEndMs(weekIndex: number): number {
  return getWeekStartMs(weekIndex + 1);
}

export function formatKst(timestampMs: number): string {
  const parts = new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(timestampMs));

  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";

  return `${get("year")}.${get("month")}.${get("day")} ${get("hour")}:${get("minute")}`;
}

export function formatWeekRange(weekIndex: number): string {
  return `${formatKst(getWeekStartMs(weekIndex))} ~ ${formatKst(getWeekEndMs(weekIndex))}`;
}
