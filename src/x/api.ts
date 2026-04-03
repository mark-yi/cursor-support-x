import type { AppConfig } from "../config.ts";
import type { SupportMention, XMentionsResponse } from "../types.ts";
import { readJsonFile } from "../utils/fs.ts";

function compareMentions(left: SupportMention, right: SupportMention): number {
  const dateScore = new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();
  if (dateScore !== 0) {
    return dateScore;
  }

  if (left.id === right.id) {
    return 0;
  }

  return isMentionIdAfter(left.id, right.id) ? 1 : -1;
}

function isMentionIdAfter(left: string, right: string): boolean {
  try {
    return BigInt(left) > BigInt(right);
  } catch {
    return left > right;
  }
}

export function buildMentionPermalink(handle: string, mentionId: string): string {
  return `https://x.com/${handle}/status/${mentionId}`;
}

function normalizeMentionRecord(
  record: Record<string, unknown>,
  handleByUserId: Map<string, string>
): SupportMention | null {
  const id = String(record.id || "");
  const text = String(record.text || "").trim();
  const authorId = String(record.author_id || "");
  const authorHandle = handleByUserId.get(authorId) || `user-${authorId}`;
  const createdAt = String(record.created_at || new Date().toISOString());

  if (!id || !text || !authorId) {
    return null;
  }

  return {
    id,
    text,
    authorId,
    authorHandle,
    createdAt,
    permalink: buildMentionPermalink(authorHandle, id),
    conversationId: record.conversation_id ? String(record.conversation_id) : null,
    inReplyToUserId: record.in_reply_to_user_id ? String(record.in_reply_to_user_id) : null
  };
}

export function normalizeMentionsResponse(payload: XMentionsResponse | SupportMention[]): SupportMention[] {
  if (Array.isArray(payload)) {
    return [...payload].sort(compareMentions);
  }

  const users = payload.includes?.users || [];
  const handleByUserId = new Map<string, string>();
  for (const user of users) {
    const id = String(user.id || "");
    const username = String(user.username || "");
    if (id && username) {
      handleByUserId.set(id, username);
    }
  }

  return (payload.data || [])
    .map((record) => normalizeMentionRecord(record, handleByUserId))
    .filter((mention): mention is SupportMention => Boolean(mention))
    .sort(compareMentions);
}

async function resolveXUserId(config: AppConfig): Promise<string> {
  if (config.xUserId) {
    return config.xUserId;
  }

  if (!config.xBearerToken) {
    throw new Error("X_BEARER_TOKEN is required for live polling.");
  }

  const response = await fetch(`${config.xApiBaseUrl}/users/by/username/${config.xUsername}`, {
    headers: {
      Authorization: `Bearer ${config.xBearerToken}`,
      "User-Agent": "cursor-support-x-demo/0.1"
    }
  });

  if (!response.ok) {
    throw new Error(`Failed to resolve X username: ${response.status} ${response.statusText}`);
  }

  const payload = (await response.json()) as { data?: { id?: string } };
  const userId = payload.data?.id;
  if (!userId) {
    throw new Error(`No X user ID returned for @${config.xUsername}.`);
  }

  return userId;
}

export async function fetchMentions(config: AppConfig, sinceId?: string | null): Promise<SupportMention[]> {
  if (!config.xBearerToken) {
    throw new Error("X_BEARER_TOKEN is required for live polling.");
  }

  const userId = await resolveXUserId(config);
  const url = new URL(`${config.xApiBaseUrl}/users/${userId}/mentions`);
  url.searchParams.set("max_results", "20");
  url.searchParams.set("expansions", "author_id");
  url.searchParams.set("tweet.fields", "author_id,conversation_id,created_at,in_reply_to_user_id");
  url.searchParams.set("user.fields", "username");
  if (sinceId) {
    url.searchParams.set("since_id", sinceId);
  }

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${config.xBearerToken}`,
      "User-Agent": "cursor-support-x-demo/0.1"
    }
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch mentions: ${response.status} ${response.statusText}`);
  }

  const payload = (await response.json()) as XMentionsResponse;
  return normalizeMentionsResponse(payload);
}

export async function loadMentionsFromFixture(path: string): Promise<SupportMention[]> {
  const payload = await readJsonFile<XMentionsResponse | SupportMention[]>(path);
  return normalizeMentionsResponse(payload);
}
