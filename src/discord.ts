import type { DiscordMessage, Env } from "./types";

const API_BASE = "https://discord.com/api/v10";
const MAX_MESSAGE_PAGES = 40;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function discordApi(
  env: Env,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bot ${env.DISCORD_BOT_TOKEN}`);

  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers,
    });

    if (response.status !== 429) return response;

    const body = (await response.json()) as { retry_after?: number };
    const retryMs = Math.max(250, Math.ceil((body.retry_after ?? 1) * 1000));
    await sleep(retryMs);
  }

  throw new Error("Discord API rate limit 재시도 횟수를 초과했습니다.");
}

async function expectOk(response: Response, label: string): Promise<Response> {
  if (response.ok) return response;

  const text = await response.text();
  throw new Error(`${label} 실패: HTTP ${response.status} ${text}`);
}

export async function fetchMessagesSince(
  env: Env,
  channelId: string,
  sinceMs: number,
): Promise<DiscordMessage[]> {
  const collected: DiscordMessage[] = [];
  let before: string | undefined;

  for (let page = 0; page < MAX_MESSAGE_PAGES; page += 1) {
    const query = new URLSearchParams({ limit: "100" });
    if (before) query.set("before", before);

    const response = await discordApi(
      env,
      `/channels/${channelId}/messages?${query.toString()}`,
    );
    await expectOk(response, "채널 메시지 조회");

    const messages = (await response.json()) as DiscordMessage[];
    if (messages.length === 0) return collected;

    let reachedBaseline = false;

    for (const message of messages) {
      const timestampMs = Date.parse(message.timestamp);

      if (timestampMs >= sinceMs) {
        collected.push(message);
      } else {
        reachedBaseline = true;
      }
    }

    if (reachedBaseline || messages.length < 100) {
      return collected;
    }

    before = messages[messages.length - 1]?.id;
    if (!before) return collected;
  }

  throw new Error(
    "채널 메시지가 4,000개를 넘어 한 번에 스캔할 수 없습니다. " +
      "장기 운영 시 저장소 도입을 검토하세요.",
  );
}

export async function editOriginalInteractionResponse(
  applicationId: string,
  interactionToken: string,
  content: string,
): Promise<void> {
  const response = await fetch(
    `${API_BASE}/webhooks/${applicationId}/${interactionToken}/messages/@original`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content,
        allowed_mentions: { parse: [] },
      }),
    },
  );

  await expectOk(response, "Interaction 응답 수정");
}

export async function sendChannelMessage(
  env: Env,
  channelId: string,
  content: string,
  allowEveryoneMention = false,
): Promise<void> {
  const response = await discordApi(env, `/channels/${channelId}/messages`, {
    method: "POST",
    body: JSON.stringify({
      content,
      allowed_mentions: allowEveryoneMention
        ? { parse: ["everyone"] }
        : { parse: [] },
    }),
  });

  await expectOk(response, "Discord 메시지 전송");
}

export async function channelHasRecentMessageContaining(
  env: Env,
  channelId: string,
  marker: string,
): Promise<boolean> {
  const response = await discordApi(
    env,
    `/channels/${channelId}/messages?limit=20`,
  );
  await expectOk(response, "최근 결과 메시지 조회");

  const messages = (await response.json()) as DiscordMessage[];
  return messages.some(
    (message) => message.author.bot === true && message.content.includes(marker),
  );
}
