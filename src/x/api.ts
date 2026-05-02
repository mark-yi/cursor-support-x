import type { AppConfig } from "../config.ts";
import type { SupportMention, XMentionsResponse } from "../types.ts";
import { readJsonFile } from "../utils/fs.ts";

let resolvedXUserIdCache: string | null = null;

interface XRequestError extends Error {
  status: number;
}

export interface XEndpointProbe {
  name: string;
  ok: boolean;
  status: number;
  detail: string;
}

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

function normalizeBearerToken(token: string): string {
  return token.trim().replace(/^Bearer\s+/i, "");
}

function getXReadToken(config: AppConfig): string {
  const token = config.xBearerToken || config.xUserAccessToken;
  if (!token) {
    throw new Error("X_USER_ACCESS_TOKEN or X_BEARER_TOKEN is required for live polling.");
  }
  return normalizeBearerToken(token);
}

function getXWriteToken(config: AppConfig): string {
  if (!config.xUserAccessToken) {
    throw new Error("X_USER_ACCESS_TOKEN is required to post replies.");
  }
  return normalizeBearerToken(config.xUserAccessToken);
}

async function readXError(response: Response): Promise<string> {
  try {
    const body = await response.text();
    return body ? `${response.status} ${response.statusText}: ${body}` : `${response.status} ${response.statusText}`;
  } catch {
    return `${response.status} ${response.statusText}`;
  }
}

async function buildXRequestError(message: string, response: Response): Promise<XRequestError> {
  const error = new Error(`${message}: ${await readXError(response)}`) as XRequestError;
  error.status = response.status;
  return error;
}

async function probeXEndpoint(name: string, token: string, url: URL): Promise<XEndpointProbe> {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      "User-Agent": "cursor-support-x-demo/0.1"
    }
  });

  let detail = "";
  try {
    const text = await response.text();
    detail = text.slice(0, 240).replace(/\s+/g, " ").trim();
  } catch {
    detail = "";
  }

  return {
    name,
    ok: response.ok,
    status: response.status,
    detail
  };
}

function shouldFallbackToSearch(error: unknown): boolean {
  const status = (error as Partial<XRequestError>).status;
  return status === 401 || status === 403;
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

  if (resolvedXUserIdCache) {
    return resolvedXUserIdCache;
  }

  const token = getXReadToken(config);

  const response = await fetch(`${config.xApiBaseUrl}/users/by/username/${config.xUsername}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      "User-Agent": "cursor-support-x-demo/0.1"
    }
  });

  if (!response.ok) {
    throw new Error(`Failed to resolve X username: ${await readXError(response)}`);
  }

  const payload = (await response.json()) as { data?: { id?: string } };
  const userId = payload.data?.id;
  if (!userId) {
    throw new Error(`No X user ID returned for @${config.xUsername}.`);
  }

  resolvedXUserIdCache = userId;
  return userId;
}

export async function fetchMentions(config: AppConfig, sinceId?: string | null): Promise<SupportMention[]> {
  const token = getXReadToken(config);
  const userId = await resolveXUserId(config);
  try {
    return await fetchMentionsByTimeline(config, token, userId, sinceId);
  } catch (error) {
    if (!shouldFallbackToSearch(error)) {
      throw error;
    }

    console.warn("X mentions endpoint is unauthorized for this token; falling back to recent search.");
    return fetchMentionsByRecentSearch(config, token, sinceId);
  }
}

async function fetchMentionsByTimeline(
  config: AppConfig,
  token: string,
  userId: string,
  sinceId?: string | null
): Promise<SupportMention[]> {
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
      Authorization: `Bearer ${token}`,
      "User-Agent": "cursor-support-x-demo/0.1"
    }
  });

  if (!response.ok) {
    throw await buildXRequestError("Failed to fetch mentions", response);
  }

  const payload = (await response.json()) as XMentionsResponse;
  return normalizeMentionsResponse(payload);
}

async function fetchMentionsByRecentSearch(
  config: AppConfig,
  token: string,
  sinceId?: string | null
): Promise<SupportMention[]> {
  const username = config.xUsername.replace(/^@/, "");
  const url = new URL(`${config.xApiBaseUrl}/tweets/search/recent`);
  url.searchParams.set("query", `@${username} -is:retweet`);
  url.searchParams.set("max_results", "20");
  url.searchParams.set("expansions", "author_id");
  url.searchParams.set("tweet.fields", "author_id,conversation_id,created_at,in_reply_to_user_id");
  url.searchParams.set("user.fields", "username");
  if (sinceId) {
    url.searchParams.set("since_id", sinceId);
  }

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      "User-Agent": "cursor-support-x-demo/0.1"
    }
  });

  if (!response.ok) {
    throw await buildXRequestError("Failed to search recent mentions", response);
  }

  const payload = (await response.json()) as XMentionsResponse;
  return normalizeMentionsResponse(payload).filter((mention) =>
    mention.text.toLowerCase().includes(`@${username.toLowerCase()}`)
  );
}

export async function createReply(config: AppConfig, mentionId: string, text: string): Promise<string> {
  const token = getXWriteToken(config);
  const response = await fetch(`${config.xApiBaseUrl}/tweets`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "User-Agent": "cursor-support-x-demo/0.1"
    },
    body: JSON.stringify({
      text,
      reply: {
        in_reply_to_tweet_id: mentionId
      }
    })
  });

  if (!response.ok) {
    throw new Error(`Failed to post reply: ${await readXError(response)}`);
  }

  const payload = (await response.json()) as { data?: { id?: string } };
  const replyId = payload.data?.id;
  if (!replyId) {
    throw new Error("No reply post ID returned by X.");
  }

  return replyId;
}

export async function loadMentionsFromFixture(path: string): Promise<SupportMention[]> {
  const payload = await readJsonFile<XMentionsResponse | SupportMention[]>(path);
  return normalizeMentionsResponse(payload);
}

export async function smokeTestXReadAccess(config: AppConfig): Promise<{ userId: string; mentionCount: number }> {
  const userId = await resolveXUserId(config);
  const mentions = await fetchMentions({ ...config, xUserId: userId });
  return {
    userId,
    mentionCount: mentions.length
  };
}

export async function probeXReadAccess(config: AppConfig): Promise<XEndpointProbe[]> {
  const token = getXReadToken(config);
  const username = config.xUsername.replace(/^@/, "");
  const userLookupUrl = new URL(`${config.xApiBaseUrl}/users/by/username/${username}`);
  const recentSearchUrl = new URL(`${config.xApiBaseUrl}/tweets/search/recent`);
  recentSearchUrl.searchParams.set("query", "hello world");
  recentSearchUrl.searchParams.set("max_results", "10");

  const mentionSearchUrl = new URL(`${config.xApiBaseUrl}/tweets/search/recent`);
  mentionSearchUrl.searchParams.set("query", `@${username} -is:retweet`);
  mentionSearchUrl.searchParams.set("max_results", "10");

  const probes: XEndpointProbe[] = [];
  const userLookup = await probeXEndpoint("user lookup", token, userLookupUrl);
  probes.push(userLookup);

  probes.push(await probeXEndpoint("recent search: hello world", token, recentSearchUrl));
  probes.push(await probeXEndpoint(`recent search: @${username}`, token, mentionSearchUrl));

  if (userLookup.ok) {
    try {
      const payload = JSON.parse(userLookup.detail) as { data?: { id?: string } };
      const userId = payload.data?.id;
      if (userId) {
        const mentionsUrl = new URL(`${config.xApiBaseUrl}/users/${userId}/mentions`);
        mentionsUrl.searchParams.set("max_results", "10");
        probes.push(await probeXEndpoint("mentions timeline", token, mentionsUrl));
      }
    } catch {
      // The user lookup body is only diagnostic text. Ignore parse failures.
    }
  }

  return probes;
}
