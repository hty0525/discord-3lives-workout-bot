export interface Env {
  DISCORD_BOT_TOKEN: string;
  DISCORD_PUBLIC_KEY: string;
  DISCORD_APPLICATION_ID: string;
  WORKOUT_CHANNEL_ID: string;
  REGISTRY_CHANNEL_ID: string;
  RESULT_CHANNEL_ID: string;
}

export interface DiscordMessage {
  id: string;
  channel_id: string;
  content: string;
  timestamp: string;
  author: {
    id: string;
    username?: string;
    global_name?: string | null;
    bot?: boolean;
  };
}

export interface InteractionOption {
  name: string;
  type: number;
  value?: string | number | boolean;
}

export interface InteractionPayload {
  id: string;
  application_id: string;
  type: number;
  token: string;
  guild_id?: string;
  channel_id?: string;
  user?: DiscordUser;
  member?: {
    user?: DiscordUser;
    nick?: string | null;
    permissions?: string;
  };
  data?: {
    name?: string;
    options?: InteractionOption[];
    custom_id?: string;
    component_type?: number;
    values?: string[];
    resolved?: {
      users?: Record<string, DiscordUser>;
      members?: Record<string, {
        nick?: string | null;
        permissions?: string;
      }>;
    };
  };
}

export interface DiscordUser {
  id: string;
  username: string;
  global_name?: string | null;
  bot?: boolean;
}

export type RegistryAction = "REGISTER" | "UNREGISTER" | "SET_LIVES";

export interface RegistryEvent {
  action: RegistryAction;
  userId: string;
  name: string;
  effectiveWeekIndex: number;
  initialLives?: number;
  /** 이 사람의 주간 목표(분모). 없으면 DEFAULT_WEEKLY_TARGET으로 간주한다(과거 기록 호환용). */
  weeklyTarget?: number;
  createdAt: string;
  actorId: string;
  sourceMessageId?: string;
}

export interface MembershipState {
  userId: string;
  name: string;
  active: boolean;
  /**
   * 현재 상태(등록/재등록/목숨조절)가 시작된 주차.
   * 기존 필드명을 유지해 과거 코드와 호환합니다.
   */
  registeredWeekIndex: number;
  initialLives: number;
  weeklyTarget: number;
}
