import assert from "node:assert/strict";
import test from "node:test";
import { parseWorkoutCount } from "../src/parser";

test("x/3을 읽는다", () => {
  assert.equal(parseWorkoutCount("운동 1/3"), 1);
  assert.equal(parseWorkoutCount("오늘  4 / 3 완료"), 4);
  assert.equal(parseWorkoutCount("10/3"), 10);
});

test("분모가 1~5 범위면 사람마다 다른 목표도 인식한다", () => {
  assert.equal(parseWorkoutCount("2/2"), 2);
  assert.equal(parseWorkoutCount("1/5"), 1);
});

test("분모가 1~5 범위를 벗어나면 무시한다", () => {
  assert.equal(parseWorkoutCount("2/6"), null);
  assert.equal(parseWorkoutCount("3/30"), null);
});

test("x/y가 없으면 null", () => {
  assert.equal(parseWorkoutCount("운동 완료"), null);
});

test("여러 사람 기록을 모은 수동 요약글(> 목n 형식)은 개인 인증으로 보지 않는다", () => {
  assert.equal(parseWorkoutCount("도은 3/3 > 목1"), null);
  assert.equal(
    parseWorkoutCount(
      "✅ 도은 3/3 > 목1\n✅ 하늘 0/3 > 목2 리셋\n✅ 희재  3/3 > 목3",
    ),
    null,
  );
});

test("한 메시지에 x/y가 두 번 이상 나오면(요약글로 간주) 무시한다", () => {
  assert.equal(parseWorkoutCount("오늘 3/3, 어제 2/3"), null);
});
