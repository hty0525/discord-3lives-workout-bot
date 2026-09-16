/**
 * 사람마다 다른 주간 목표(분모)를 지정할 수 있다.
 * 등록 시 지정하지 않으면 기본값을 쓴다.
 */
export const DEFAULT_WEEKLY_TARGET = 3;
export const MIN_WEEKLY_TARGET = 1;
export const MAX_WEEKLY_TARGET = 5;

/** /운동 명령으로 올릴 수 있는 주간 운동 횟수 상한. */
export const MAX_WORKOUT_COUNT = 20;

/**
 * 시스템의 주차 계산 기준점.
 * 반드시 월요일 10:00 KST 권장.
 */
export const BASELINE_START_ISO = "2026-09-07T10:00:00+09:00";

/**
 * 인증 기록 메시지에 이 단어가 있으면 작성 시각 기준 직전 주차로 귀속.
 * 예: "✅ <@id> 지난주 운동 인증 3/3"
 */
export const LATE_PREVIOUS_WEEK_KEYWORD = "지난주";

/**
 * 등록/탈퇴 기록을 Discord 설정 채널에 남길 때 사용하는 마커.
 * 일반 사용자가 위조하지 못하도록 REGISTRY_CHANNEL_ID는 관리자/봇 전용 채널로 두세요.
 */
export const REGISTRY_MARKER = "[WORKOUT_REGISTRY_V1]";
