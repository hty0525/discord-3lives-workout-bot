import type { DiscordMessage, MembershipState, RegistryEvent } from "./types";
import { parseWorkoutCount } from "./parser";
import {
	getActiveMembershipsAtWeek,
	getMembershipStateAtWeek,
} from "./registry";
import {
	formatWeekRange,
	getMessageWeekIndex,
	getWeekIndexFromMs,
} from "./week";

export type WeeklyCounts = Map<string, Map<number, number>>;

export function formatLives(lives: number): string {
	return "❤️".repeat(Math.max(0, lives));
}

export interface AppliedWeekResult {
	count: number;
	success: boolean;
	livesBefore: number;
	livesAfter: number;
	reset: boolean;
}

export function buildWeeklyCounts(messages: DiscordMessage[]): WeeklyCounts {
	const counts: WeeklyCounts = new Map();

	for (const message of messages) {
		if (message.author.bot) continue;

		const count = parseWorkoutCount(message.content);
		if (count === null) continue;

		const weekIndex = getMessageWeekIndex(message.timestamp, message.content);
		if (weekIndex < 0) continue;

		let memberWeeks = counts.get(message.author.id);
		if (!memberWeeks) {
			memberWeeks = new Map();
			counts.set(message.author.id, memberWeeks);
		}

		const previous = memberWeeks.get(weekIndex) ?? 0;
		memberWeeks.set(weekIndex, Math.max(previous, count));
	}

	return counts;
}

export function getCount(
	weeklyCounts: WeeklyCounts,
	userId: string,
	weekIndex: number,
): number {
	return weeklyCounts.get(userId)?.get(weekIndex) ?? 0;
}

export function applyWeek(
	lives: number,
	count: number,
	target: number,
): AppliedWeekResult {
	const livesBefore = lives;
	const missingCount = Math.max(0, target - count);
	const success = missingCount === 0;

	if (success) {
		return {
			count,
			success,
			livesBefore,
			livesAfter: lives,
			reset: false,
		};
	}

	let livesAfter = lives;
	let reset = false;

	// 목표 횟수에서 모자란 만큼 목숨을 한 칸씩 차감합니다.
	// 2/3 -> 1칸, 1/3 -> 2칸, 0/3 -> 3칸.
	// 차감 도중 목0이 되면 즉시 💀 후 목3으로 초기화하고,
	// 아직 남은 차감 횟수가 있으면 계속 차감합니다.
	for (let i = 0; i < missingCount; i += 1) {
		livesAfter -= 1;

		if (livesAfter <= 0) {
			livesAfter = 3;
			reset = true;
		}
	}

	return {
		count,
		success,
		livesBefore,
		livesAfter,
		reset,
	};
}

export function getLivesBeforeWeek(
	membership: MembershipState,
	registryEvents: RegistryEvent[],
	weeklyCounts: WeeklyCounts,
	weekIndex: number,
): number {
	let lives = membership.initialLives;
	let target = membership.weeklyTarget;

	for (
		let index = membership.registeredWeekIndex;
		index < weekIndex;
		index += 1
	) {
		const activeState = getMembershipStateAtWeek(
			registryEvents,
			membership.userId,
			index,
		);

		// 탈퇴 구간은 실패로 계산하지 않습니다.
		if (!activeState) continue;

		// 재등록/목숨·목표 조절 시 새 기준값으로 새 구간을 시작합니다.
		if (activeState.registeredWeekIndex !== membership.registeredWeekIndex) {
			membership = activeState;
			lives = activeState.initialLives;
			target = activeState.weeklyTarget;
		}

		const count = getCount(weeklyCounts, membership.userId, index);
		lives = applyWeek(lives, count, target).livesAfter;
	}

	return lives;
}

function renderFinalLine(
	membership: MembershipState,
	registryEvents: RegistryEvent[],
	weeklyCounts: WeeklyCounts,
	weekIndex: number,
): string {
	const count = getCount(weeklyCounts, membership.userId, weekIndex);
	const livesBefore = getLivesBeforeWeek(
		membership,
		registryEvents,
		weeklyCounts,
		weekIndex,
	);
	const result = applyWeek(livesBefore, count, membership.weeklyTarget);

	if (result.success) {
		return `${membership.name}  ${count}/${membership.weeklyTarget} > ${formatLives(result.livesAfter)} ✅`;
	}

	if (result.reset) {
		return `${membership.name}  ${count}/${membership.weeklyTarget} > 💀 ${formatLives(result.livesAfter)}`;
	}

	return `${membership.name}  ${count}/${membership.weeklyTarget} > ${formatLives(result.livesAfter)}`;
}

function renderCurrentLine(
	membership: MembershipState,
	registryEvents: RegistryEvent[],
	weeklyCounts: WeeklyCounts,
	weekIndex: number,
): string {
	const count = getCount(weeklyCounts, membership.userId, weekIndex);
	const lives = getLivesBeforeWeek(
		membership,
		registryEvents,
		weeklyCounts,
		weekIndex,
	);
	const success = count >= membership.weeklyTarget;

	return `${membership.name}  ${count}/${membership.weeklyTarget} > ${formatLives(lives)}${success ? " (진행중)" : ""}`;
}

export function renderCurrentSummary(
	registryEvents: RegistryEvent[],
	weeklyCounts: WeeklyCounts,
	nowMs: number,
): string {
	const weekIndex = getWeekIndexFromMs(nowMs);

	if (weekIndex < 0) {
		return "아직 기준 시작 시각 전입니다.";
	}

	const memberships = getActiveMembershipsAtWeek(registryEvents, weekIndex);

	if (memberships.length === 0) {
		return "등록된 운동 참여자가 없습니다. `/등록`으로 먼저 등록하세요.";
	}

	const lines = memberships.map((membership) =>
		renderCurrentLine(membership, registryEvents, weeklyCounts, weekIndex),
	);

	return [
		`🏃 이번 주 운동 현황 · ${formatWeekRange(weekIndex)}`,
		"",
		...lines,
		"",
		"이번주도 운동 화이팅 합시다!",
	].join("\n");
}

export function renderFinalSummary(
	registryEvents: RegistryEvent[],
	weeklyCounts: WeeklyCounts,
	weekIndex: number,
): string {
	if (weekIndex < 0) {
		return "집계할 완료 주차가 없습니다.";
	}

	const memberships = getActiveMembershipsAtWeek(registryEvents, weekIndex);

	if (memberships.length === 0) {
		return `📊 주간 운동 집계 · ${formatWeekRange(weekIndex)}\n\n등록된 참여자가 없습니다.`;
	}

	const lines = memberships.map((membership) =>
		renderFinalLine(membership, registryEvents, weeklyCounts, weekIndex),
	);

	return [
		`📊 주간 운동 집계 · ${formatWeekRange(weekIndex)}`,
		"",
		...lines,
		"",
		"이번주도 고생 많았습니다!",
	].join("\n");
}

export function finalSummaryMarker(weekIndex: number): string {
	return `📊 주간 운동 집계 · ${formatWeekRange(weekIndex)}`;
}
