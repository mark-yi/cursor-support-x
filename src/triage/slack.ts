import type { SupportPayload } from "../types.ts";

function uniqueUrls(payload: Pick<SupportPayload, "sources">): string[] {
  return Array.from(
    new Set(
      payload.sources
        .map((source) => source.url.trim())
        .filter(Boolean)
    )
  );
}

export function buildSlackFields(
  payload: Pick<SupportPayload, "mention" | "suggested_response" | "suggested_reply" | "sources">
): SupportPayload["slack_fields"] {
  const sourceLinks = uniqueUrls(payload);

  return {
    new_mention: payload.mention.text,
    suggested_response: payload.suggested_response,
    suggested_reply: payload.suggested_reply,
    link_to_post: payload.mention.permalink,
    sources: sourceLinks.length > 0 ? sourceLinks.join(", ") : "none"
  };
}

export function buildSlackMessage(
  payload: Pick<SupportPayload, "mention" | "suggested_response" | "suggested_reply" | "sources">
): string {
  const fields = buildSlackFields(payload);

  return [
    `new mention: ${fields.new_mention}`,
    `suggested response: ${fields.suggested_response}`,
    `suggested reply: ${fields.suggested_reply}`,
    "",
    `link to post: ${fields.link_to_post}`,
    `sources: ${fields.sources}`
  ].join("\n");
}
