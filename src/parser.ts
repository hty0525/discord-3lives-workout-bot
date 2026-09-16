import { LATE_PREVIOUS_WEEK_KEYWORD } from "./config";
import type { DiscordMessage } from "./types";

export interface WorkoutLog {
  userId: string;
  count: number;
}

/**
 * /운동 명령이 운동 인증 채널에 남기는 기록 메시지.
 * 봇이 쓴 이 메시지가 곧 저장소이므로 사람이 쓴 채팅은 집계에 들어가지 않는다.
 * 예: "✅ <@123> 운동 인증 2/3", "✅ <@123> 지난주 운동 인증 2/3"
 */
const WORKOUT_LOG_PATTERN = new RegExp(
  `^✅ <@!?(\\d+)> (?:${LATE_PREVIOUS_WEEK_KEYWORD} )?운동 인증 (\\d+)/(\\d+)$`,
);

export function serializeWorkoutLog(
  userId: string,
  count: number,
  weeklyTarget: number,
  previousWeek: boolean,
): string {
  const weekLabel = previousWeek ? `${LATE_PREVIOUS_WEEK_KEYWORD} ` : "";
  return `✅ <@${userId}> ${weekLabel}운동 인증 ${count}/${weeklyTarget}`;
}

export function parseWorkoutLog(message: DiscordMessage): WorkoutLog | null {
  if (!message.author.bot) return null;

  const match = message.content.match(WORKOUT_LOG_PATTERN);
  if (!match) return null;

  return { userId: match[1], count: Number(match[2]) };
}
