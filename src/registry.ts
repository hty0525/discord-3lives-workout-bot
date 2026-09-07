import {
  DEFAULT_WEEKLY_TARGET,
  MAX_WEEKLY_TARGET,
  MIN_WEEKLY_TARGET,
  REGISTRY_MARKER,
} from "./config";
import type {
  DiscordMessage,
  MembershipState,
  RegistryEvent,
} from "./types";

export function serializeRegistryEvent(event: RegistryEvent): string {
  return `${REGISTRY_MARKER} ${JSON.stringify(event)}`;
}

export function parseRegistryEvent(message: DiscordMessage): RegistryEvent | null {
  if (!message.author.bot) return null;
  if (!message.content.startsWith(`${REGISTRY_MARKER} `)) return null;

  const raw = message.content.slice(REGISTRY_MARKER.length + 1);

  try {
    const parsed = JSON.parse(raw) as RegistryEvent;

    if (
      !["REGISTER", "UNREGISTER", "SET_LIVES"].includes(parsed.action) ||
      typeof parsed.userId !== "string" ||
      typeof parsed.name !== "string" ||
      typeof parsed.effectiveWeekIndex !== "number" ||
      typeof parsed.createdAt !== "string" ||
      typeof parsed.actorId !== "string"
    ) {
      return null;
    }

    if (
      (parsed.action === "REGISTER" || parsed.action === "SET_LIVES") &&
      (typeof parsed.initialLives !== "number" ||
        parsed.initialLives < 1 ||
        parsed.initialLives > 3)
    ) {
      return null;
    }

    if (
      parsed.weeklyTarget !== undefined &&
      (typeof parsed.weeklyTarget !== "number" ||
        parsed.weeklyTarget < MIN_WEEKLY_TARGET ||
        parsed.weeklyTarget > MAX_WEEKLY_TARGET)
    ) {
      return null;
    }

    return {
      ...parsed,
      sourceMessageId: message.id,
    };
  } catch {
    return null;
  }
}

export function buildRegistryEvents(messages: DiscordMessage[]): RegistryEvent[] {
  return messages
    .map(parseRegistryEvent)
    .filter((event): event is RegistryEvent => event !== null)
    .sort((a, b) => {
      if (a.effectiveWeekIndex !== b.effectiveWeekIndex) {
        return a.effectiveWeekIndex - b.effectiveWeekIndex;
      }
      return Date.parse(a.createdAt) - Date.parse(b.createdAt);
    });
}

export function getUserEvents(
  events: RegistryEvent[],
  userId: string,
): RegistryEvent[] {
  return events.filter((event) => event.userId === userId);
}

export function hasEverRegistered(
  events: RegistryEvent[],
  userId: string,
): boolean {
  return events.some(
    (event) => event.userId === userId && event.action === "REGISTER",
  );
}

export function getMembershipStateAtWeek(
  events: RegistryEvent[],
  userId: string,
  weekIndex: number,
): MembershipState | null {
  const relevant = events.filter(
    (event) =>
      event.userId === userId &&
      event.effectiveWeekIndex <= weekIndex,
  );

  if (relevant.length === 0) return null;

  const latest = relevant[relevant.length - 1];

  if (latest.action === "UNREGISTER") {
    return null;
  }

  if (
    (latest.action === "REGISTER" || latest.action === "SET_LIVES") &&
    typeof latest.initialLives === "number"
  ) {
    return {
      userId,
      name: latest.name,
      active: true,
      registeredWeekIndex: latest.effectiveWeekIndex,
      initialLives: latest.initialLives,
      weeklyTarget: latest.weeklyTarget ?? DEFAULT_WEEKLY_TARGET,
    };
  }

  return null;
}

export function getAllUserIds(events: RegistryEvent[]): string[] {
  return [...new Set(events.map((event) => event.userId))];
}

export function getActiveMembershipsAtWeek(
  events: RegistryEvent[],
  weekIndex: number,
): MembershipState[] {
  return getAllUserIds(events)
    .map((userId) => getMembershipStateAtWeek(events, userId, weekIndex))
    .filter((state): state is MembershipState => state !== null)
    .sort((a, b) => a.name.localeCompare(b.name, "ko"));
}
