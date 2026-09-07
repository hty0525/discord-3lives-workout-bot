import assert from "node:assert/strict";
import test from "node:test";
import {
  getMessageWeekIndex,
  getWeekIndexFromMs
} from "../src/week";

test("월요일 10:00 KST가 새 주 시작", () => {
  assert.equal(
    getWeekIndexFromMs(Date.parse("2026-09-07T09:59:59+09:00")),
    -1
  );
  assert.equal(
    getWeekIndexFromMs(Date.parse("2026-09-07T10:00:00+09:00")),
    0
  );
  assert.equal(
    getWeekIndexFromMs(Date.parse("2026-09-14T09:59:59+09:00")),
    0
  );
  assert.equal(
    getWeekIndexFromMs(Date.parse("2026-09-14T10:00:00+09:00")),
    1
  );
});

test('"지난주"가 있으면 한 주 전으로 귀속', () => {
  assert.equal(
    getMessageWeekIndex(
      "2026-09-14T11:00:00+09:00",
      "지난주 운동 3/3"
    ),
    0
  );
});
