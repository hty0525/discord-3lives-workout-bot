import assert from "node:assert/strict";
import test from "node:test";
import {
  buildRegistryEvents,
  getMembershipStateAtWeek,
  serializeRegistryEvent,
} from "../src/registry";
import type { DiscordMessage, RegistryEvent } from "../src/types";

function msg(id: string, content: string, timestamp: string): DiscordMessage {
  return {
    id,
    channel_id: "registry",
    content,
    timestamp,
    author: {
      id: "bot",
      bot: true,
    },
  };
}

test("등록 기록을 파싱하고 해당 주부터 활성화", () => {
  const event: RegistryEvent = {
    action: "REGISTER",
    userId: "u1",
    name: "태영",
    effectiveWeekIndex: 2,
    initialLives: 3,
    createdAt: "2026-09-21T01:00:00.000Z",
    actorId: "u1",
  };

  const events = buildRegistryEvents([
    msg("1", serializeRegistryEvent(event), event.createdAt),
  ]);

  assert.equal(getMembershipStateAtWeek(events, "u1", 1), null);
  assert.equal(getMembershipStateAtWeek(events, "u1", 2)?.initialLives, 3);
});

test("SET_LIVES는 해당 주부터 새 목숨 기준점이 된다", () => {
  const register: RegistryEvent = {
    action: "REGISTER",
    userId: "u1",
    name: "태영",
    effectiveWeekIndex: 0,
    initialLives: 3,
    createdAt: "2026-09-07T01:00:00.000Z",
    actorId: "u1",
  };

  const setLives: RegistryEvent = {
    action: "SET_LIVES",
    userId: "u1",
    name: "태영",
    effectiveWeekIndex: 2,
    initialLives: 1,
    createdAt: "2026-09-21T01:01:00.000Z",
    actorId: "admin",
  };

  const events = buildRegistryEvents([
    msg("1", serializeRegistryEvent(register), register.createdAt),
    msg("2", serializeRegistryEvent(setLives), setLives.createdAt),
  ]);

  assert.equal(getMembershipStateAtWeek(events, "u1", 1)?.initialLives, 3);
  assert.equal(getMembershipStateAtWeek(events, "u1", 2)?.initialLives, 1);
  assert.equal(getMembershipStateAtWeek(events, "u1", 2)?.registeredWeekIndex, 2);
});

test("탈퇴 기록 이후 비활성", () => {
  const register: RegistryEvent = {
    action: "REGISTER",
    userId: "u1",
    name: "태영",
    effectiveWeekIndex: 0,
    initialLives: 3,
    createdAt: "2026-09-07T01:00:00.000Z",
    actorId: "u1",
  };

  const unregister: RegistryEvent = {
    action: "UNREGISTER",
    userId: "u1",
    name: "태영",
    effectiveWeekIndex: 2,
    createdAt: "2026-09-21T01:01:00.000Z",
    actorId: "admin",
  };

  const events = buildRegistryEvents([
    msg("1", serializeRegistryEvent(register), register.createdAt),
    msg("2", serializeRegistryEvent(unregister), unregister.createdAt),
  ]);

  assert.notEqual(getMembershipStateAtWeek(events, "u1", 1), null);
  assert.equal(getMembershipStateAtWeek(events, "u1", 2), null);
});
