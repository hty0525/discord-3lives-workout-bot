import assert from "node:assert/strict";
import test from "node:test";
import { buildWeeklyCounts } from "../src/aggregate";
import { parseWorkoutLog, serializeWorkoutLog } from "../src/parser";
import type { DiscordMessage } from "../src/types";

function message(
  content: string,
  overrides: Partial<DiscordMessage> = {},
): DiscordMessage {
  return {
    id: "1",
    channel_id: "c",
    content,
    timestamp: "2026-09-14T11:00:00+09:00",
    author: { id: "bot", bot: true },
    ...overrides,
  };
}

test("직렬화한 기록을 다시 읽으면 같은 값이 나온다", () => {
  assert.equal(serializeWorkoutLog("123", 2, 3, false), "✅ <@123> 운동 인증 2/3");
  assert.equal(
    serializeWorkoutLog("123", 3, 3, true),
    "✅ <@123> 지난주 운동 인증 3/3",
  );

  assert.deepEqual(parseWorkoutLog(message(serializeWorkoutLog("123", 2, 3, false))), {
    userId: "123",
    count: 2,
  });
  assert.deepEqual(parseWorkoutLog(message("✅ <@!123> 운동 인증 10/5")), {
    userId: "123",
    count: 10,
  });
});

test("봇이 쓴 기록 메시지만 인정한다", () => {
  assert.equal(
    parseWorkoutLog(message("✅ <@123> 운동 인증 2/3", { author: { id: "123" } })),
    null,
  );
  assert.equal(
    parseWorkoutLog(
      message("✅ <@123> 운동 인증 2/3", { author: { id: "123", bot: false } }),
    ),
    null,
  );
});

test("사람이 채팅에 쓴 x/y는 인증으로 보지 않는다", () => {
  for (const content of [
    "운동 2/3",
    "헬스 1/3",
    "3/3",
    "운동 안하고 2/3 카운트 할 수 있겠군",
  ]) {
    assert.equal(parseWorkoutLog(message(content, { author: { id: "u" } })), null);
    assert.equal(parseWorkoutLog(message(content)), null);
  }
});

test("기록 형식이 조금이라도 다르면 무시한다", () => {
  assert.equal(parseWorkoutLog(message("✅ <@123> 운동 인증 2/3 완료")), null);
  assert.equal(parseWorkoutLog(message("<@123> 운동 인증 2/3")), null);
  assert.equal(parseWorkoutLog(message("✅ <@123> 운동 인증 a/3")), null);
});

test("주간 집계는 사용자·주차별로 가장 나중 기록을 쓰고 지난주는 직전 주로 귀속한다", () => {
  const counts = buildWeeklyCounts([
    // Discord API처럼 최신 메시지가 먼저 온다.
    message("✅ <@11> 운동 인증 1/3", { id: "3", timestamp: "2026-09-14T13:00:00+09:00" }),
    message("✅ <@11> 운동 인증 3/3", { id: "2", timestamp: "2026-09-14T12:00:00+09:00" }),
    message("✅ <@11> 지난주 운동 인증 3/3", { id: "1", timestamp: "2026-09-14T11:00:00+09:00" }),
    message("✅ <@22> 운동 인증 1/3", { id: "4" }),
    message("운동 5/3", { id: "5", author: { id: "22" } }),
  ]);

  // 3/3 뒤에 1/3으로 정정했으므로 1이 남는다.
  assert.equal(counts.get("11")?.get(1), 1);
  assert.equal(counts.get("11")?.get(0), 3);
  assert.equal(counts.get("22")?.get(1), 1);
});
