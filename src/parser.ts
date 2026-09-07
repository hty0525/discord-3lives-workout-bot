import { MAX_WEEKLY_TARGET, MIN_WEEKLY_TARGET } from "./config";

const COUNT_PATTERN = /(\d+)\s*\/\s*(\d+)(?!\d)/g;

/**
 * "이름 x/y > 목n" 형태로 여러 사람 기록을 한 메시지에 모아 적은 수동 요약글은
 * 개인 인증이 아니므로 걸러낸다. 이런 글을 그대로 파싱하면 첫 줄의 값이
 * 그 메시지를 올린 사람 본인 기록으로 잘못 잡힌다.
 */
function looksLikeSummary(content: string): boolean {
  if (content.includes(">")) return true;

  const matches = content.match(COUNT_PATTERN);
  return matches !== null && matches.length > 1;
}

/**
 * 분모(목표)는 등록된 사람마다 다를 수 있어 채팅에서는 형식만 확인한다.
 * 실제 성공/실패 판정은 그 사람의 등록된 weeklyTarget 기준으로 aggregate에서 계산한다.
 */
export function parseWorkoutCount(content: string): number | null {
  if (looksLikeSummary(content)) return null;

  const match = content.match(/(\d+)\s*\/\s*(\d+)(?!\d)/);

  if (!match) return null;

  const count = Number(match[1]);
  const denominator = Number(match[2]);

  if (!Number.isFinite(count)) return null;
  if (denominator < MIN_WEEKLY_TARGET || denominator > MAX_WEEKLY_TARGET) return null;

  return count;
}
