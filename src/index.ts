import {
  buildWeeklyCounts,
  finalSummaryMarker,
  formatLives,
  getCount,
  renderCurrentSummary,
  renderFinalSummary,
} from "./aggregate";
import {
  addReaction,
  channelHasRecentMessageContaining,
  editOriginalInteractionResponse,
  fetchMessagesSince,
  fetchRecentMessages,
  sendChannelMessage,
} from "./discord";
import { parseWorkoutCount } from "./parser";
import {
  DEFAULT_WEEKLY_TARGET,
  MAX_WEEKLY_TARGET,
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

const WORKOUT_REACTION_EMOJI = "✅";
const RECENT_MESSAGE_SCAN_LIMIT = 100;
const DAILY_DIGEST_CRON = "0 1 * * *";

const HELP_TEXT = [
  "📖 운동봇 사용법",
  "",
  "**집계 주기**",
  "매주 월요일 10:00 KST ~ 다음 월요일 10:00 KST 직전",
  "",
  "**운동 인증**",
  "채팅에 `x/y` 형태로 올리면 인증돼요 (예: 운동 3/3, 헬스(2/3))",
  "· y(분모)는 본인이 등록한 목표 횟수예요 (기본 3회, 1~5회 중 선택 가능)",
  "· 같은 주에 여러 번 올리면 그중 최댓값을 씁니다",
  "· \"지난주 3/3\"처럼 '지난주'를 포함하면 직전 주 기록으로 들어가요",
  "",
  "**목숨 규칙**",
  "목표 미달 시 부족한 횟수만큼 목숨을 차감해요 (2/3→-1, 1/3→-2, 0/3→-3)",
  "목숨이 0이 되는 순간 💀 표시 후 즉시 ❤️❤️❤️로 초기화되고, 남은 차감은 계속 적용돼요",
  "",
  "**명령어**",
  "/등록 [목표] — 본인 등록 (관리자는 사용자·목숨도 지정 가능)",
  "/일괄등록 목숨 [목표] — 관리자용, 여러 명 한 번에 등록",
  "/목숨조절 목숨 [사용자] — 관리자용, 목숨 변경",
  "/목표조절 목표 [사용자] — 관리자용, 목표(분모) 변경",
  "/탈퇴 사용자 — 관리자용, 탈퇴 처리",
  "/집계 [대상] — 이번 주 또는 지난주 현황 확인 (채널에 공개로 표시)",
  "/룰렛 [대상] — 그 주 목표를 채운 사람 중 무작위로 한 명 추첨 (채널에 공개로 표시)",
  "/도움말 — 지금 이 설명 보기",
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

function pickRandom<T>(items: T[]): T {
  const buffer = new Uint32Array(1);
  crypto.getRandomValues(buffer);
  const index = Math.floor((buffer[0] / (0xffffffff + 1)) * items.length);
  return items[index];
}

async function handleRoulette(
  env: Env,
  interaction: InteractionPayload,
): Promise<string> {
  const nowMs = Date.now();
  const registryEvents = await loadRegistry(env);
  const weeklyCounts = await loadWorkoutCounts(env);

  const target = getOptionValue(interaction, "대상");
  const weekIndex =
    target === "previous"
      ? getWeekIndexFromMs(nowMs) - 1
      : getWeekIndexFromMs(nowMs);

  if (weekIndex < 0) {
    return "아직 집계할 주차가 없습니다.";
  }

  const memberships = getActiveMembershipsAtWeek(registryEvents, weekIndex);
  const eligible = memberships.filter(
    (membership) =>
      getCount(weeklyCounts, membership.userId, weekIndex) >=
      membership.weeklyTarget,
  );

  if (eligible.length === 0) {
    return `📛 ${formatWeekRange(weekIndex)} 기준 목표를 채운 사람이 없어서 룰렛을 돌릴 수 없어요.`;
  }

  const winner = pickRandom(eligible);
  const candidateNames = eligible.map((membership) => membership.name).join(", ");

  return [
    `🎰 룰렛 · ${formatWeekRange(weekIndex)}`,
    "",
    `후보(목표 달성자 ${eligible.length}명): ${candidateNames}`,
    "",
    `🎉 당첨: **${winner.name}**`,
  ].join("\n");
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
  if (!isAdmin(interaction)) {
    return "관리자만 목표를 조절할 수 있습니다.";
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
      // 목표만 바꾸는 요청이므로 기존 목숨은 그대로 유지한다.
      initialLives: state.initialLives,
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
  if (!isAdmin(interaction)) {
    return "관리자만 목표를 조절할 수 있습니다.";
  }

  const weeklyTarget = getOptionValue(interaction, "목표");
  const targetOption = getOptionValue(interaction, "사용자");

  if (typeof weeklyTarget !== "number") {
    return "변경할 목표를 지정하세요.";
  }

  if (typeof targetOption !== "string") {
    return "조절할 사용자를 지정하세요.";
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

async function reactToNewWorkoutMessages(env: Env): Promise<void> {
  const messages = await fetchRecentMessages(
    env,
    env.WORKOUT_CHANNEL_ID,
    RECENT_MESSAGE_SCAN_LIMIT,
  );

  for (const message of messages) {
    if (message.author.bot) continue;
    if (parseWorkoutCount(message.content) === null) continue;

    const alreadyReacted = message.reactions?.some(
      (reaction) =>
        reaction.emoji.name === WORKOUT_REACTION_EMOJI && reaction.me,
    );
    if (alreadyReacted) continue;

    await addReaction(
      env,
      env.WORKOUT_CHANNEL_ID,
      message.id,
      WORKOUT_REACTION_EMOJI,
    );
  }
}

async function runDailyDigest(env: Env): Promise<void> {
  assertRuntimeConfig(env);

  await reactToNewWorkoutMessages(env);

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
          data: { content: HELP_TEXT, flags: EPHEMERAL },
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

      if (commandName === "목표조절") {
        if (!isAdmin(interaction)) {
          return json({
            type: RESPONSE_MESSAGE,
            data: {
              content: "관리자만 목표를 조절할 수 있습니다.",
              flags: EPHEMERAL,
            },
          });
        }

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

        if (typeof target !== "string") {
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

      if (commandName === "등록" || commandName === "탈퇴") {
        ctx.waitUntil(finishCommand(env, interaction));
        return json({ type: RESPONSE_DEFERRED_MESSAGE, data: { flags: EPHEMERAL } });
      }
    }

    if (interaction.type === INTERACTION_MESSAGE_COMPONENT) {
      const customId = interaction.data?.custom_id ?? "";

      if (
        customId.startsWith("bulk-register:") ||
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
    if (controller.cron === DAILY_DIGEST_CRON) {
      await runDailyDigest(env);
      return;
    }

    await runWeeklyCron(env, controller.scheduledTime);
  },
};
