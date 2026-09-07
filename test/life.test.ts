import assert from "node:assert/strict";
import test from "node:test";
import { applyWeek } from "../src/aggregate";

test("3/3 이상이면 목숨 유지", () => {
  assert.deepEqual(applyWeek(2, 3, 3), {
    count: 3,
    success: true,
    livesBefore: 2,
    livesAfter: 2,
    reset: false
  });
});

test("2/3이면 1회 부족 -> 목숨 1 차감", () => {
  assert.deepEqual(applyWeek(3, 2, 3), {
    count: 2,
    success: false,
    livesBefore: 3,
    livesAfter: 2,
    reset: false
  });
});

test("1/3이면 2회 부족 -> 목숨 2 차감", () => {
  assert.deepEqual(applyWeek(3, 1, 3), {
    count: 1,
    success: false,
    livesBefore: 3,
    livesAfter: 1,
    reset: false
  });
});

test("0/3이면 3회 부족 -> 목3에서 💀 후 목3", () => {
  assert.deepEqual(applyWeek(3, 0, 3), {
    count: 0,
    success: false,
    livesBefore: 3,
    livesAfter: 3,
    reset: true
  });
});

test("리셋 뒤 남은 차감도 계속 적용", () => {
  assert.deepEqual(applyWeek(1, 0, 3), {
    count: 0,
    success: false,
    livesBefore: 1,
    livesAfter: 1,
    reset: true
  });

  assert.deepEqual(applyWeek(2, 0, 3), {
    count: 0,
    success: false,
    livesBefore: 2,
    livesAfter: 2,
    reset: true
  });
});

test("목표(분모)가 사람마다 다르면 그 목표 기준으로 부족분을 계산한다", () => {
  assert.deepEqual(applyWeek(3, 1, 2), {
    count: 1,
    success: false,
    livesBefore: 3,
    livesAfter: 2,
    reset: false
  });

  assert.deepEqual(applyWeek(3, 2, 2), {
    count: 2,
    success: true,
    livesBefore: 3,
    livesAfter: 3,
    reset: false
  });
});
