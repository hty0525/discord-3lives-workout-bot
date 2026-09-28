import {
  applyWeek,
  buildWeeklyCounts,
  finalSummaryMarker,
  formatLives,
  getCount,
  getLivesBeforeWeek,
  renderCurrentSummary,
  renderFinalSummary,
} from "./aggregate";
import {
  channelHasRecentMessageContaining,
  editOriginalInteractionResponse,
  fetchMessagesSince,
  sendChannelMessage,
} from "./discord";
import { serializeWorkoutLog } from "./parser";
import {
  DEFAULT_WEEKLY_TARGET,
  MAX_WEEKLY_TARGET,
  MAX_WORKOUT_COUNT,
  MIN_WEEKLY_TARGET,
} from "./config";
import {
  buildRegistryEvents,
  getActiveMembershipsAtWeek,
  getMembershipStateAtWeek,
  hasEverRegistered,
  serializeRegistryEvent,
} from "./registry";
import type {
  DiscordUser,
  Env,
  InteractionPayload,
  RegistryEvent,
} from "./types";
import {
  BASELINE_START_MS,
  formatWeekRange,
  getWeekIndexFromMs,
  getWeekStartMs,
} from "./week";
import { verifyDiscordRequest } from "./verify";

const INTERACTION_PING = 1;
const INTERACTION_APPLICATION_COMMAND = 2;
const INTERACTION_MESSAGE_COMPONENT = 3;

const RESPONSE_PONG = 1;
const RESPONSE_MESSAGE = 4;
const RESPONSE_DEFERRED_MESSAGE = 5;
const RESPONSE_DEFERRED_UPDATE_MESSAGE = 6;

const EPHEMERAL = 1 << 6;

const PERMISSION_ADMINISTRATOR = 1n << 3n;
const PERMISSION_MANAGE_GUILD = 1n << 5n;

const USER_SELECT_COMPONENT = 5;

const DAY_MS = 24 * 60 * 60 * 1000;

const HELP_TEXT = [
  "📖 운동봇 사용법",
  "",
  "**한 주 흐름** (월요일 10:00 KST ~ 다음 월요일 10:00 KST)",
  "· 운동한 날 `/운동` → 이번 주 횟수 +1",
  "· 화~일 10:00 이번 주 현황판이 올라와요 (알림 없음)",
  "· 월요일 10:00 지난주 마감표가 `@here` 알림과 함께 올라와요",
  "· 마감표를 보고 누군가 `/룰렛`을 돌려요",
  "",
  "**운동 인증 `/운동`**",
  "· 횟수를 비우면 +1. 대부분 이것만 쓰면 돼요",
  "· ⚠️ `횟수:N`은 더하기가 아니라 그 주 총 횟수로 덮어써요 (1회 더 했으면 비워 두세요)",
  "· 잘못 올렸으면 `/운동 횟수:맞는값`으로 다시 올리면 가장 나중 기록으로 바뀌어요",
  "· 월요일 10시 마감 뒤에 지난주 걸 올리려면 `/운동 대상:지난주`",
  "· 채팅에 \"운동 2/3\"이라고 쓰는 건 집계되지 않아요",
  "",
  "**목숨 규칙**",
  "· 목표(기본 3회)에 모자란 만큼 차감: 2/3→-1, 1/3→-2, 0/3→-3",
  "· 0이 되면 💀 리셋 후 ❤️❤️❤️로 다시 시작, 남은 차감은 계속 적용",
  "· 마감표는 ✅ 달성 / ⚠️ 차감 / 💀 리셋으로 나눠 보여줘요",
  "",
  "**룰렛 `/룰렛`** (기본 지난주)",
  "· 💀 리셋된 사람 전원이 지급자",
  "· 지급자 수만큼 살아남은 사람 중에서 받을 사람을 뽑아요",
  "· 💀가 없으면 돌리지 않아요",
  "",
  "**명령어**",
  "/운동 [횟수] [대상] — 운동 인증",
  "/집계 [대상] — 이번 주 현황 (대상:지난주면 지난주 마감표)",
  "/룰렛 [대상] — 지급자 수만큼 받을 사람 추첨",
  "/등록 [목표] — 참여 등록 (목표 1~5회, 기본 3회). 등록한 주부터 집계, 재등록은 관리자에게",
  "/목표조절 목표 — 내 주간 목표 변경. 이번 주부터 적용, 목숨은 그대로",
  "/도움말 [보기] [공개] — 사용법 / 업데이트 내역 (공개:True면 채널에 올림)",
  "",
  "**관리자 전용**",
  "/운동 사용자:@OO — 대신 기록 · /일괄운동 — 여러 명 한 번에 기록",
  "/등록 사용자·목숨 지정 · /일괄등록 · /목숨조절 · /목표조절 사용자 지정 · /탈퇴",
].join("\n");

const UPDATE_TEXT = [
  "🆕 운동봇 업데이트",
  "",
  "**v3.1.0 (2026.09.28)**",
  "· 월요일 10시에 지난주 마감표가 빠지고 새 주 현황판만 올라가던 문제 수정",
  "  → 월요일은 마감표만 `@here`, 화~일은 현황판",
  "· 마감표를 ✅ 달성 / ⚠️ 차감 / 💀 리셋으로 나누고 목숨 변화를 전→후로 표시",
  "  예) 윤지훈 1/3 ❤️❤️❤️ → ❤️ (-2)",
  "· 룰렛: 💀 리셋된 사람이 지급자, 그 수만큼 생존자 중에서 받을 사람 추첨",
  "  💀가 없으면 룰렛을 돌리지 않음",
  "· `/룰렛` 대상 기본값을 지난주로 변경",
  "· `/도움말`을 한 주 흐름 중심으로 정리, `보기:업데이트`로 이 내역 확인",
  "· `/도움말 공개:True`면 채널에 모두가 보는 메시지로 올라가요",
  "· `/목표조절` 하면 목숨이 처음 등록 값으로 되돌아가던 문제 수정",
  "",
  "**v3.0.0 (2026.09.16)**",
  "· 운동 인증을 `/운동` 슬래시 명령으로 변경 (채팅 \"운동 2/3\"은 집계 안 됨)",
  "· 횟수 비우면 +1, 같은 주 여러 번 올리면 가장 나중 기록 사용",
  "· 관리자 대신 기록 `/운동 사용자:`, 여러 명 기록 `/일괄운동` 추가",
  "· `/목표조절`을 본인도 사용 가능",
].join("\n");

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

function assertRuntimeConfig(env: Env): void {
  const required: Array<[string, string | undefined]> = [
    ["DISCORD_BOT_TOKEN", env.DISCORD_BOT_TOKEN],
    ["DISCORD_PUBLIC_KEY", env.DISCORD_PUBLIC_KEY],
    ["DISCORD_APPLICATION_ID", env.DISCORD_APPLICATION_ID],
    ["WORKOUT_CHANNEL_ID", env.WORKOUT_CHANNEL_ID],
    ["REGISTRY_CHANNEL_ID", env.REGISTRY_CHANNEL_ID],
    ["RESULT_CHANNEL_ID", env.RESULT_CHANNEL_ID],
  ];

  for (const [name, value] of required) {
    if (!value || value.startsWith("CHANGE_ME_")) {
      throw new Error(`${name} 설정이 필요합니다.`);
    }
  }
}

function getInvoker(interaction: InteractionPayload): DiscordUser | null {
  return interaction.member?.user ?? interaction.user ?? null;
}

function isAdmin(interaction: InteractionPayload): boolean {
  const raw = interaction.member?.permissions;
  if (!raw) return false;

  try {
    const permissions = BigInt(raw);
    return (
      (permissions & PERMISSION_ADMINISTRATOR) !== 0n ||
      (permissions & PERMISSION_MANAGE_GUILD) !== 0n
    );
  } catch {
    return false;
  }
}

function getOptionValue(
  interaction: InteractionPayload,
  name: string,
): string | number | boolean | undefined {
  return interaction.data?.options?.find((option) => option.name === name)?.value;
}

function resolveTargetUser(
  interaction: InteractionPayload,
  targetUserId: string,
): DiscordUser | null {
  return interaction.data?.resolved?.users?.[targetUserId] ?? null;
}

function resolveDisplayName(
  interaction: InteractionPayload,
  user: DiscordUser,
): string {
  const member = interaction.data?.resolved?.members?.[user.id];
  return member?.nick || user.global_name || user.username;
}

function getSelectedUsers(interaction: InteractionPayload): DiscordUser[] {
  const values = interaction.data?.values ?? [];
  const resolved = interaction.data?.resolved?.users ?? {};

  return values
    .map((userId) => resolved[userId])
    .filter((user): user is DiscordUser => Boolean(user));
}

function selectUsersResponse(
  content: string,
  customId: string,
  placeholder: string,
): Response {
  return json({
    type: RESPONSE_MESSAGE,
    data: {
      content,
      flags: EPHEMERAL,
      components: [
        {
          type: 1,
          components: [
            {
              type: USER_SELECT_COMPONENT,
              custom_id: customId,
              placeholder,
              min_values: 1,
              max_values: 25,
            },
          ],
        },
      ],
    },
  });
}

async function loadRegistry(env: Env) {
  const messages = await fetchMessagesSince(
    env,
    env.REGISTRY_CHANNEL_ID,
    BASELINE_START_MS,
  );
  return buildRegistryEvents(messages);
}

async function loadWorkoutCounts(env: Env) {
  const messages = await fetchMessagesSince(
    env,
    env.WORKOUT_CHANNEL_ID,
    BASELINE_START_MS,
  );
  return buildWeeklyCounts(messages);
}

async function handleSummary(
  env: Env,
  interaction: InteractionPayload,
): Promise<string> {
  const nowMs = Date.now();
  const registryEvents = await loadRegistry(env);
  const weeklyCounts = await loadWorkoutCounts(env);

  const target = getOptionValue(interaction, "대상");

  if (target === "previous") {
    return renderFinalSummary(
      registryEvents,
      weeklyCounts,
      getWeekIndexFromMs(nowMs) - 1,
    );
  }

  return renderCurrentSummary(registryEvents, weeklyCounts, nowMs);
}

function pickRandomIndex(length: number): number {
  const buffer = new Uint32Array(1);
  crypto.getRandomValues(buffer);
  return Math.floor((buffer[0] / (0xffffffff + 1)) * length);
}

/** items에서 중복 없이 최대 count개를 무작위로 뽑는다. */
function pickRandomMany<T>(items: T[], count: number): T[] {
  const pool = [...items];
  const picked: T[] = [];
  while (picked.length < count && pool.length > 0) {
    picked.push(pool.splice(pickRandomIndex(pool.length), 1)[0]);
  }
  return picked;
}

async function handleRoulette(
  env: Env,
  interaction: InteractionPayload,
): Promise<string> {
  const nowMs = Date.now();
  const registryEvents = await loadRegistry(env);
  const weeklyCounts = await loadWorkoutCounts(env);

  // 룰렛은 마감된 주를 두고 돌리므로 대상을 비우면 지난주로 봅니다.
  const target = getOptionValue(interaction, "대상");
  const weekIndex =
    target === "current"
      ? getWeekIndexFromMs(nowMs)
      : getWeekIndexFromMs(nowMs) - 1;

  if (weekIndex < 0) {
    return "아직 집계할 주차가 없습니다.";
  }

  // 그 주 차감으로 💀가 된 사람이 지급자, 나머지 생존자가 후보입니다.
  // 지급자 수만큼 생존자 중에서 받을 사람을 중복 없이 뽑습니다.
  const memberships = getActiveMembershipsAtWeek(registryEvents, weekIndex);
  const payers: typeof memberships = [];
  const survivors: typeof memberships = [];

  for (const membership of memberships) {
    const livesBefore = getLivesBeforeWeek(
      membership,
      registryEvents,
      weeklyCounts,
      weekIndex,
    );
    const count = getCount(weeklyCounts, membership.userId, weekIndex);
    const { reset } = applyWeek(livesBefore, count, membership.weeklyTarget);
    (reset ? payers : survivors).push(membership);
  }

  const range = formatWeekRange(weekIndex);

  if (payers.length === 0) {
    return `🎰 ${range} 기준 💀가 된 사람이 없어서 룰렛을 돌리지 않아요.`;
  }

  if (survivors.length === 0) {
    return `📛 ${range} 기준 살아남은 사람이 없어서 룰렛을 돌릴 수 없어요.`;
  }

  const winners = pickRandomMany(survivors, payers.length);
  const names = (items: typeof memberships) =>
    items.map((membership) => membership.name).join(", ");

  return [
    `🎰 룰렛 · ${range}`,
    "",
    `💀 지급(${payers.length}명): ${names(payers)}`,
    `후보(생존자 ${survivors.length}명): ${names(survivors)}`,
    "",
    `🎉 당첨(${winners.length}명): **${names(winners)}**`,
  ].join("\n");
}

function parseWorkoutCountOption(
  value: string | number | boolean | undefined,
): number | undefined {
  if (value === undefined) return undefined;
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 0 ||
    value > MAX_WORKOUT_COUNT
  ) {
    throw new Error(`횟수는 0~${MAX_WORKOUT_COUNT} 사이 정수여야 합니다.`);
  }
  return value;
}

/**
 * 여러 사용자의 운동 기록을 남긴다. 횟수를 비우면 각자 그 주 현재 기록에 1을 더한다.
 * 본인 한 명만 기록할 때를 빼면 관리자만 쓸 수 있다.
 */
async function recordWorkouts(
  env: Env,
  interaction: InteractionPayload,
  users: DiscordUser[],
  countOption: number | undefined,
  previousWeek: boolean,
): Promise<string> {
  const actor = getInvoker(interaction);
  if (!actor) return "사용자 정보를 확인할 수 없습니다.";

  if (users.length === 0) return "대상 사용자가 없습니다.";

  const selfOnly = users.length === 1 && users[0].id === actor.id;
  if (!selfOnly && !isAdmin(interaction)) {
    return "본인 기록만 올릴 수 있어요. 다른 사람 기록은 관리자에게 요청하세요.";
  }

  const weekIndex = getWeekIndexFromMs(Date.now()) - (previousWeek ? 1 : 0);
  if (weekIndex < 0) {
    return "아직 집계할 주차가 없습니다.";
  }

  const registryEvents = await loadRegistry(env);
  const weeklyCounts =
    countOption === undefined ? await loadWorkoutCounts(env) : null;

  const recorded: string[] = [];
  const skipped: string[] = [];

  for (const user of users) {
    const state = getMembershipStateAtWeek(registryEvents, user.id, weekIndex);

    if (!state) {
      skipped.push(`${resolveDisplayName(interaction, user)}(미등록)`);
      continue;
    }

    const count =
      weeklyCounts === null
        ? (countOption as number)
        : Math.min(getCount(weeklyCounts, user.id, weekIndex) + 1, MAX_WORKOUT_COUNT);

    await sendChannelMessage(
      env,
      env.WORKOUT_CHANNEL_ID,
      serializeWorkoutLog(user.id, count, state.weeklyTarget, previousWeek),
    );

    recorded.push(`${state.name} ${count}/${state.weeklyTarget}`);
  }

  if (selfOnly && recorded.length === 0) {
    return "등록된 참여자가 아니에요. 먼저 `/등록`으로 등록해 주세요.";
  }

  const lines = [
    `✅ 운동 인증 완료 · ${formatWeekRange(weekIndex)}`,
    ...recorded,
  ];

  if (skipped.length > 0) {
    lines.push("", `건너뜀 ${skipped.length}명: ${skipped.join(", ")}`);
  }

  lines.push("", "횟수를 고치고 싶으면 `횟수:N`을 적어 다시 올리세요. 가장 나중 기록을 씁니다.");

  return lines.join("\n");
}

async function handleWorkout(
  env: Env,
  interaction: InteractionPayload,
): Promise<string> {
  const actor = getInvoker(interaction);
  if (!actor) return "사용자 정보를 확인할 수 없습니다.";

  const countOption = parseWorkoutCountOption(getOptionValue(interaction, "횟수"));
  const previousWeek = getOptionValue(interaction, "대상") === "previous";

  const userOption = getOptionValue(interaction, "사용자");
  let targetUser = actor;

  if (typeof userOption === "string") {
    if (!isAdmin(interaction)) {
      return "본인 기록만 올릴 수 있어요. 다른 사람 기록은 관리자에게 요청하세요.";
    }

    const resolved = resolveTargetUser(interaction, userOption);
    if (!resolved) return "기록할 사용자를 확인할 수 없습니다.";
    targetUser = resolved;
  }

  return recordWorkouts(env, interaction, [targetUser], countOption, previousWeek);
}

async function handleRegister(
  env: Env,
  interaction: InteractionPayload,
): Promise<string> {
  const actor = getInvoker(interaction);
  if (!actor) return "사용자 정보를 확인할 수 없습니다.";

  const currentWeekIndex = getWeekIndexFromMs(Date.now());
  if (currentWeekIndex < 0) {
    return "아직 시스템 기준 시작 시각 전입니다.";
  }

  const registryEvents = await loadRegistry(env);

  const userOption = getOptionValue(interaction, "사용자");
  const livesOption = getOptionValue(interaction, "목숨");
  const weeklyTargetOption = getOptionValue(interaction, "목표");

  let targetUser = actor;
  let initialLives = 3;
  let weeklyTarget = DEFAULT_WEEKLY_TARGET;

  if (typeof weeklyTargetOption === "number") {
    if (
      weeklyTargetOption < MIN_WEEKLY_TARGET ||
      weeklyTargetOption > MAX_WEEKLY_TARGET
    ) {
      return `목표는 ${MIN_WEEKLY_TARGET}~${MAX_WEEKLY_TARGET} 사이여야 합니다.`;
    }
    weeklyTarget = weeklyTargetOption;
  }

  const adminMode = typeof userOption === "string" || livesOption !== undefined;

  if (adminMode) {
    if (!isAdmin(interaction)) {
      return "관리자만 다른 사용자 또는 시작 목숨을 지정할 수 있습니다.";
    }

    if (typeof userOption === "string") {
      const resolved = resolveTargetUser(interaction, userOption);
      if (!resolved) return "등록할 사용자를 확인할 수 없습니다.";
      targetUser = resolved;
    }

    if (typeof livesOption === "number") {
      initialLives = livesOption;
    }
  } else if (hasEverRegistered(registryEvents, actor.id)) {
    return "이미 등록 이력이 있습니다. 재등록은 관리자에게 요청하세요.";
  }

  if (targetUser.bot) {
    return "봇 계정은 운동 참여자로 등록할 수 없습니다.";
  }

  const currentState = getMembershipStateAtWeek(
    registryEvents,
    targetUser.id,
    currentWeekIndex,
  );

  if (currentState) {
    return `${currentState.name}님은 이미 등록되어 있습니다.`;
  }

  const displayName =
    targetUser.id === actor.id && !adminMode
      ? (interaction.member?.nick || actor.global_name || actor.username)
      : resolveDisplayName(interaction, targetUser);

  const event: RegistryEvent = {
    action: "REGISTER",
    userId: targetUser.id,
    name: displayName,
    effectiveWeekIndex: currentWeekIndex,
    initialLives,
    weeklyTarget,
    createdAt: new Date().toISOString(),
    actorId: actor.id,
  };

  await sendChannelMessage(
    env,
    env.REGISTRY_CHANNEL_ID,
    serializeRegistryEvent(event),
  );

  return `✅ ${displayName} 등록 완료 · 시작 목숨: ${formatLives(initialLives)} · 주간 목표: ${weeklyTarget}회\n궁금한 점은 \`/도움말\` 참고하세요.`;
}

async function registerSelectedUsers(
  env: Env,
  interaction: InteractionPayload,
  initialLives: number,
  weeklyTarget: number,
): Promise<string> {
  if (!isAdmin(interaction)) {
    return "관리자만 일괄등록을 사용할 수 있습니다.";
  }

  const actor = getInvoker(interaction);
  if (!actor) return "사용자 정보를 확인할 수 없습니다.";

  const selected = getSelectedUsers(interaction);
  if (selected.length === 0) return "선택된 사용자가 없습니다.";

  const currentWeekIndex = getWeekIndexFromMs(Date.now());
  const registryEvents = await loadRegistry(env);

  const registered: string[] = [];
  const skipped: string[] = [];

  for (const user of selected) {
    if (user.bot) {
      skipped.push(`${user.username}(봇)`);
      continue;
    }

    const currentState = getMembershipStateAtWeek(
      registryEvents,
      user.id,
      currentWeekIndex,
    );

    if (currentState) {
      skipped.push(`${currentState.name}(이미 등록)`);
      continue;
    }

    const name = resolveDisplayName(interaction, user);
    const event: RegistryEvent = {
      action: "REGISTER",
      userId: user.id,
      name,
      effectiveWeekIndex: currentWeekIndex,
      initialLives,
      weeklyTarget,
      createdAt: new Date().toISOString(),
      actorId: actor.id,
    };

    await sendChannelMessage(
      env,
      env.REGISTRY_CHANNEL_ID,
      serializeRegistryEvent(event),
    );

    registered.push(`${name} → ${formatLives(initialLives)} · 목표 ${weeklyTarget}회`);
  }

  const lines = [
    `✅ 일괄등록 완료 · ${registered.length}명`,
    ...registered,
  ];

  if (skipped.length > 0) {
    lines.push("", `건너뜀 ${skipped.length}명: ${skipped.join(", ")}`);
  }

  return lines.join("\n");
}

async function adjustLives(
  env: Env,
  interaction: InteractionPayload,
  users: DiscordUser[],
  lives: number,
): Promise<string> {
  if (!isAdmin(interaction)) {
    return "관리자만 목숨을 조절할 수 있습니다.";
  }

  const actor = getInvoker(interaction);
  if (!actor) return "사용자 정보를 확인할 수 없습니다.";

  if (users.length === 0) return "대상 사용자가 없습니다.";

  const currentWeekIndex = getWeekIndexFromMs(Date.now());
  const registryEvents = await loadRegistry(env);

  const adjusted: string[] = [];
  const skipped: string[] = [];

  for (const user of users) {
    const state = getMembershipStateAtWeek(
      registryEvents,
      user.id,
      currentWeekIndex,
    );

    if (!state) {
      skipped.push(`${resolveDisplayName(interaction, user)}(미등록)`);
      continue;
    }

    const name = resolveDisplayName(interaction, user) || state.name;

    const event: RegistryEvent = {
      action: "SET_LIVES",
      userId: user.id,
      name,
      effectiveWeekIndex: currentWeekIndex,
      initialLives: lives,
      // 목숨만 바꾸는 요청이므로 기존에 등록된 목표는 그대로 유지한다.
      weeklyTarget: state.weeklyTarget,
      createdAt: new Date().toISOString(),
      actorId: actor.id,
    };

    await sendChannelMessage(
      env,
      env.REGISTRY_CHANNEL_ID,
      serializeRegistryEvent(event),
    );

    adjusted.push(`${name} → ${formatLives(lives)}`);
  }

  const lines = [
    `✅ 목숨 조절 완료 · ${adjusted.length}명`,
    ...adjusted,
  ];

  if (skipped.length > 0) {
    lines.push("", `건너뜀 ${skipped.length}명: ${skipped.join(", ")}`);
  }

  return lines.join("\n");
}

async function adjustTarget(
  env: Env,
  interaction: InteractionPayload,
  users: DiscordUser[],
  weeklyTarget: number,
): Promise<string> {
  const actor = getInvoker(interaction);
  if (!actor) return "사용자 정보를 확인할 수 없습니다.";

  if (users.length === 0) return "대상 사용자가 없습니다.";

  const selfOnly = users.length === 1 && users[0].id === actor.id;
  if (!selfOnly && !isAdmin(interaction)) {
    return "본인 목표만 바꿀 수 있어요. 다른 사람 목표는 관리자에게 요청하세요.";
  }

  const currentWeekIndex = getWeekIndexFromMs(Date.now());
  const registryEvents = await loadRegistry(env);
  const weeklyCounts = await loadWorkoutCounts(env);

  const adjusted: string[] = [];
  const skipped: string[] = [];

  for (const user of users) {
    const state = getMembershipStateAtWeek(
      registryEvents,
      user.id,
      currentWeekIndex,
    );

    if (!state) {
      skipped.push(`${resolveDisplayName(interaction, user)}(미등록)`);
      continue;
    }

    const name = resolveDisplayName(interaction, user) || state.name;

    const event: RegistryEvent = {
      action: "SET_LIVES",
      userId: user.id,
      name,
      effectiveWeekIndex: currentWeekIndex,
      // 목표만 바꾸는 요청이므로 이번 주 시작 시점의 현재 목숨을 이어받는다.
      // state.initialLives는 구간 시작(등록·조절) 때 값이라 그대로 쓰면 목숨이 되돌아간다.
      initialLives: getLivesBeforeWeek(
        state,
        registryEvents,
        weeklyCounts,
        currentWeekIndex,
      ),
      weeklyTarget,
      createdAt: new Date().toISOString(),
      actorId: actor.id,
    };

    await sendChannelMessage(
      env,
      env.REGISTRY_CHANNEL_ID,
      serializeRegistryEvent(event),
    );

    adjusted.push(`${name} → 목표 ${weeklyTarget}회`);
  }

  const lines = [
    `✅ 목표 조절 완료 · ${adjusted.length}명`,
    ...adjusted,
  ];

  if (skipped.length > 0) {
    lines.push("", `건너뜀 ${skipped.length}명: ${skipped.join(", ")}`);
  }

  return lines.join("\n");
}

async function handleLifeAdjust(
  env: Env,
  interaction: InteractionPayload,
): Promise<string> {
  if (!isAdmin(interaction)) {
    return "관리자만 목숨을 조절할 수 있습니다.";
  }

  const lives = getOptionValue(interaction, "목숨");
  const targetOption = getOptionValue(interaction, "사용자");

  if (typeof lives !== "number") {
    return "변경할 목숨을 지정하세요.";
  }

  if (typeof targetOption !== "string") {
    return "조절할 사용자를 지정하세요.";
  }

  const user = resolveTargetUser(interaction, targetOption);
  if (!user) return "사용자를 확인할 수 없습니다.";

  return adjustLives(env, interaction, [user], lives);
}

async function handleTargetAdjust(
  env: Env,
  interaction: InteractionPayload,
): Promise<string> {
  const actor = getInvoker(interaction);
  if (!actor) return "사용자 정보를 확인할 수 없습니다.";

  const weeklyTarget = getOptionValue(interaction, "목표");
  const targetOption = getOptionValue(interaction, "사용자");

  if (typeof weeklyTarget !== "number") {
    return "변경할 목표를 지정하세요.";
  }

  // 사용자를 지정하지 않으면 본인 목표를 바꾼다.
  if (typeof targetOption !== "string") {
    return adjustTarget(env, interaction, [actor], weeklyTarget);
  }

  const user = resolveTargetUser(interaction, targetOption);
  if (!user) return "사용자를 확인할 수 없습니다.";

  return adjustTarget(env, interaction, [user], weeklyTarget);
}

async function handleUnregister(
  env: Env,
  interaction: InteractionPayload,
): Promise<string> {
  if (!isAdmin(interaction)) {
    return "관리자만 참여자를 탈퇴 처리할 수 있습니다.";
  }

  const actor = getInvoker(interaction);
  if (!actor) return "사용자 정보를 확인할 수 없습니다.";

  const targetOption = getOptionValue(interaction, "사용자");
  if (typeof targetOption !== "string") {
    return "탈퇴할 사용자를 지정하세요.";
  }

  const targetUser = resolveTargetUser(interaction, targetOption);
  if (!targetUser) return "탈퇴할 사용자를 확인할 수 없습니다.";

  const currentWeekIndex = getWeekIndexFromMs(Date.now());
  const registryEvents = await loadRegistry(env);

  const state = getMembershipStateAtWeek(
    registryEvents,
    targetUser.id,
    currentWeekIndex,
  );

  if (!state) {
    return "현재 등록되어 있지 않은 사용자입니다.";
  }

  const event: RegistryEvent = {
    action: "UNREGISTER",
    userId: targetUser.id,
    name: state.name,
    effectiveWeekIndex: currentWeekIndex,
    createdAt: new Date().toISOString(),
    actorId: actor.id,
  };

  await sendChannelMessage(
    env,
    env.REGISTRY_CHANNEL_ID,
    serializeRegistryEvent(event),
  );

  return `✅ ${state.name} 탈퇴 처리 완료 · 이번 주 집계부터 제외`;
}

async function finishCommand(
  env: Env,
  interaction: InteractionPayload,
): Promise<void> {
  try {
    assertRuntimeConfig(env);

    let content: string;

    switch (interaction.data?.name) {
      case "집계":
        content = await handleSummary(env, interaction);
        break;
      case "룰렛":
        content = await handleRoulette(env, interaction);
        break;
      case "운동":
        content = await handleWorkout(env, interaction);
        break;
      case "등록":
        content = await handleRegister(env, interaction);
        break;
      case "목숨조절":
        content = await handleLifeAdjust(env, interaction);
        break;
      case "목표조절":
        content = await handleTargetAdjust(env, interaction);
        break;
      case "탈퇴":
        content = await handleUnregister(env, interaction);
        break;
      default:
        content = "지원하지 않는 명령입니다.";
    }

    await editOriginalInteractionResponse(
      interaction.application_id,
      interaction.token,
      content,
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "알 수 없는 오류가 발생했습니다.";

    await editOriginalInteractionResponse(
      interaction.application_id,
      interaction.token,
      `처리 실패: ${message}`,
    );
  }
}

async function finishComponent(
  env: Env,
  interaction: InteractionPayload,
): Promise<void> {
  try {
    assertRuntimeConfig(env);

    const customId = interaction.data?.custom_id ?? "";
    const [action, rawLives, rawTarget] = customId.split(":");

    let content: string;

    if (action === "bulk-register") {
      const lives = Number(rawLives);
      const weeklyTarget = Number(rawTarget);

      if (![1, 2, 3].includes(lives)) {
        throw new Error("목숨 값이 올바르지 않습니다.");
      }
      if (weeklyTarget < MIN_WEEKLY_TARGET || weeklyTarget > MAX_WEEKLY_TARGET) {
        throw new Error("목표 값이 올바르지 않습니다.");
      }

      content = await registerSelectedUsers(env, interaction, lives, weeklyTarget);
    } else if (action === "bulk-lives") {
      const lives = Number(rawLives);

      if (![1, 2, 3].includes(lives)) {
        throw new Error("목숨 값이 올바르지 않습니다.");
      }

      content = await adjustLives(
        env,
        interaction,
        getSelectedUsers(interaction),
        lives,
      );
    } else if (action === "bulk-workout") {
      const countOption = parseWorkoutCountOption(
        rawLives === "" ? undefined : Number(rawLives),
      );

      content = await recordWorkouts(
        env,
        interaction,
        getSelectedUsers(interaction),
        countOption,
        rawTarget === "previous",
      );
    } else if (action === "bulk-target") {
      const weeklyTarget = Number(rawLives);

      if (weeklyTarget < MIN_WEEKLY_TARGET || weeklyTarget > MAX_WEEKLY_TARGET) {
        throw new Error("목표 값이 올바르지 않습니다.");
      }

      content = await adjustTarget(
        env,
        interaction,
        getSelectedUsers(interaction),
        weeklyTarget,
      );
    } else {
      content = "지원하지 않는 선택 메뉴입니다.";
    }

    await editOriginalInteractionResponse(
      interaction.application_id,
      interaction.token,
      content,
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "알 수 없는 오류가 발생했습니다.";

    await editOriginalInteractionResponse(
      interaction.application_id,
      interaction.token,
      `처리 실패: ${message}`,
    );
  }
}

async function runWeeklyCron(
  env: Env,
  scheduledTimeMs: number,
): Promise<void> {
  assertRuntimeConfig(env);

  const completedWeekIndex = getWeekIndexFromMs(scheduledTimeMs) - 1;
  if (completedWeekIndex < 0) return;

  const registryEvents = await loadRegistry(env);
  const weeklyCounts = await loadWorkoutCounts(env);
  const marker = finalSummaryMarker(completedWeekIndex);

  const alreadyPosted = await channelHasRecentMessageContaining(
    env,
    env.RESULT_CHANNEL_ID,
    marker,
  );

  if (alreadyPosted) return;

  const summary = renderFinalSummary(
    registryEvents,
    weeklyCounts,
    completedWeekIndex,
  );

  // 자동 주간 결과만 @here 알림을 허용합니다.
  // /집계 수동 조회에는 멘션이 붙지 않습니다.
  await sendChannelMessage(
    env,
    env.RESULT_CHANNEL_ID,
    `@here ${summary}`,
    true,
  );
}

async function runDailyDigest(env: Env): Promise<void> {
  assertRuntimeConfig(env);

  const registryEvents = await loadRegistry(env);
  const weeklyCounts = await loadWorkoutCounts(env);
  const summary = renderCurrentSummary(
    registryEvents,
    weeklyCounts,
    Date.now(),
  );

  // 매일 아침 현황판은 조용히 게시합니다(@here 없음). 주간 마감 알림만 @here를 씁니다.
  await sendChannelMessage(env, env.RESULT_CHANNEL_ID, summary);
}

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/") {
      return new Response("discord-workout-worker-registration: ok");
    }

    if (request.method !== "POST" || url.pathname !== "/") {
      return new Response("Not Found", { status: 404 });
    }

    const rawBody = await request.text();
    const verified = await verifyDiscordRequest(
      env.DISCORD_PUBLIC_KEY,
      request.headers.get("X-Signature-Ed25519"),
      request.headers.get("X-Signature-Timestamp"),
      rawBody,
    );

    if (!verified) {
      return new Response("invalid request signature", { status: 401 });
    }

    let interaction: InteractionPayload;

    try {
      interaction = JSON.parse(rawBody) as InteractionPayload;
    } catch {
      return new Response("invalid json", { status: 400 });
    }

    if (interaction.type === INTERACTION_PING) {
      return json({ type: RESPONSE_PONG });
    }

    if (interaction.type === INTERACTION_APPLICATION_COMMAND) {
      const commandName = interaction.data?.name;

      if (commandName === "도움말") {
        return json({
          type: RESPONSE_MESSAGE,
          data: {
            content:
              getOptionValue(interaction, "보기") === "updates"
                ? UPDATE_TEXT
                : HELP_TEXT,
            // 공개:예면 채널에 모두가 보는 메시지로, 아니면 나만 보기로 보냅니다.
            ...(getOptionValue(interaction, "공개") === true
              ? {}
              : { flags: EPHEMERAL }),
          },
        });
      }

      if (commandName === "일괄등록") {
        if (!isAdmin(interaction)) {
          return json({
            type: RESPONSE_MESSAGE,
            data: {
              content: "관리자만 일괄등록을 사용할 수 있습니다.",
              flags: EPHEMERAL,
            },
          });
        }

        const lives = getOptionValue(interaction, "목숨");
        if (typeof lives !== "number") {
          return json({
            type: RESPONSE_MESSAGE,
            data: {
              content: "시작 목숨을 지정하세요.",
              flags: EPHEMERAL,
            },
          });
        }

        const bulkTargetOption = getOptionValue(interaction, "목표");
        const bulkWeeklyTarget =
          typeof bulkTargetOption === "number"
            ? bulkTargetOption
            : DEFAULT_WEEKLY_TARGET;

        if (
          bulkWeeklyTarget < MIN_WEEKLY_TARGET ||
          bulkWeeklyTarget > MAX_WEEKLY_TARGET
        ) {
          return json({
            type: RESPONSE_MESSAGE,
            data: {
              content: `목표는 ${MIN_WEEKLY_TARGET}~${MAX_WEEKLY_TARGET} 사이여야 합니다.`,
              flags: EPHEMERAL,
            },
          });
        }

        return selectUsersResponse(
          `시작 목숨 **${formatLives(lives)}** · 주간 목표 **${bulkWeeklyTarget}회**로 등록할 사용자를 선택하세요.`,
          `bulk-register:${lives}:${bulkWeeklyTarget}`,
          "등록할 사용자 선택 (최대 25명)",
        );
      }

      if (commandName === "일괄운동") {
        if (!isAdmin(interaction)) {
          return json({
            type: RESPONSE_MESSAGE,
            data: {
              content: "관리자만 일괄운동을 사용할 수 있습니다.",
              flags: EPHEMERAL,
            },
          });
        }

        let bulkCount: number | undefined;
        try {
          bulkCount = parseWorkoutCountOption(getOptionValue(interaction, "횟수"));
        } catch (error) {
          return json({
            type: RESPONSE_MESSAGE,
            data: {
              content: error instanceof Error ? error.message : "횟수가 올바르지 않습니다.",
              flags: EPHEMERAL,
            },
          });
        }

        const bulkWeek =
          getOptionValue(interaction, "대상") === "previous" ? "previous" : "current";
        const countLabel =
          bulkCount === undefined ? "현재 기록 +1" : `${bulkCount}회`;

        return selectUsersResponse(
          `${bulkWeek === "previous" ? "지난주" : "이번 주"} 운동 기록을 **${countLabel}**로 남길 사용자를 선택하세요.`,
          `bulk-workout:${bulkCount ?? ""}:${bulkWeek}`,
          "운동 기록을 남길 사용자 선택 (최대 25명)",
        );
      }

      if (commandName === "목표조절") {
        const weeklyTarget = getOptionValue(interaction, "목표");
        const target = getOptionValue(interaction, "사용자");

        if (typeof weeklyTarget !== "number") {
          return json({
            type: RESPONSE_MESSAGE,
            data: {
              content: "변경할 목표를 지정하세요.",
              flags: EPHEMERAL,
            },
          });
        }

        // 일반 사용자는 사용자 옵션 없이 본인 목표만 바꿀 수 있다.
        if (!isAdmin(interaction) && typeof target === "string") {
          return json({
            type: RESPONSE_MESSAGE,
            data: {
              content: "본인 목표만 바꿀 수 있어요. 다른 사람 목표는 관리자에게 요청하세요.",
              flags: EPHEMERAL,
            },
          });
        }

        if (isAdmin(interaction) && typeof target !== "string") {
          return selectUsersResponse(
            `목표를 **${weeklyTarget}회**로 변경할 사용자를 선택하세요.`,
            `bulk-target:${weeklyTarget}`,
            "목표를 변경할 사용자 선택 (최대 25명)",
          );
        }

        ctx.waitUntil(finishCommand(env, interaction));
        return json({ type: RESPONSE_DEFERRED_MESSAGE, data: { flags: EPHEMERAL } });
      }

      if (commandName === "목숨조절") {
        if (!isAdmin(interaction)) {
          return json({
            type: RESPONSE_MESSAGE,
            data: {
              content: "관리자만 목숨을 조절할 수 있습니다.",
              flags: EPHEMERAL,
            },
          });
        }

        const lives = getOptionValue(interaction, "목숨");
        const target = getOptionValue(interaction, "사용자");

        if (typeof lives !== "number") {
          return json({
            type: RESPONSE_MESSAGE,
            data: {
              content: "변경할 목숨을 지정하세요.",
              flags: EPHEMERAL,
            },
          });
        }

        // 사용자를 지정하지 않으면 여러 명을 선택할 수 있는 UI 제공.
        if (typeof target !== "string") {
          return selectUsersResponse(
            `목숨을 **${formatLives(lives)}**로 변경할 사용자를 선택하세요.`,
            `bulk-lives:${lives}`,
            "목숨을 변경할 사용자 선택 (최대 25명)",
          );
        }

        ctx.waitUntil(finishCommand(env, interaction));
        return json({ type: RESPONSE_DEFERRED_MESSAGE, data: { flags: EPHEMERAL } });
      }

      if (commandName === "집계" || commandName === "룰렛") {
        ctx.waitUntil(finishCommand(env, interaction));
        return json({ type: RESPONSE_DEFERRED_MESSAGE });
      }

      if (
        commandName === "운동" ||
        commandName === "등록" ||
        commandName === "탈퇴"
      ) {
        ctx.waitUntil(finishCommand(env, interaction));
        return json({ type: RESPONSE_DEFERRED_MESSAGE, data: { flags: EPHEMERAL } });
      }
    }

    if (interaction.type === INTERACTION_MESSAGE_COMPONENT) {
      const customId = interaction.data?.custom_id ?? "";

      if (
        customId.startsWith("bulk-register:") ||
        customId.startsWith("bulk-workout:") ||
        customId.startsWith("bulk-lives:") ||
        customId.startsWith("bulk-target:")
      ) {
        ctx.waitUntil(finishComponent(env, interaction));
        return json({ type: RESPONSE_DEFERRED_UPDATE_MESSAGE });
      }
    }

    return json({
      type: RESPONSE_MESSAGE,
      data: {
        content: "지원하지 않는 명령입니다.",
        flags: EPHEMERAL,
      },
    });
  },

  async scheduled(
    controller: ScheduledController,
    env: Env,
    _ctx: ExecutionContext,
  ): Promise<void> {
    // 크론은 매일 10:00 KST 하나만 둡니다. 같은 시각에 크론 두 개를 걸면
    // controller.cron 구분이 보장되지 않아 월요일 마감 결과가 빠졌습니다.
    // 주 시작일(월요일)에는 지난주 마감 결과만 올리고 현황판은 생략합니다.
    const scheduledTimeMs = controller.scheduledTime;
    const sinceWeekStartMs =
      scheduledTimeMs - getWeekStartMs(getWeekIndexFromMs(scheduledTimeMs));

    if (sinceWeekStartMs < DAY_MS) {
      await runWeeklyCron(env, scheduledTimeMs);
      return;
    }

    await runDailyDigest(env);
  },
};
