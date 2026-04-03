import test from "node:test";
import assert from "node:assert/strict";
import { loadMentionsFromFixture, normalizeMentionsResponse } from "../src/x/api.ts";

test("official X fixture normalizes into support mentions", async () => {
  const mentions = await loadMentionsFromFixture(new URL("../fixtures/x/mentions-response.json", import.meta.url).pathname);

  assert.equal(mentions.length, 4);
  assert.equal(mentions[0].authorHandle, "billingnerd");
  assert.equal(mentions[0].permalink, "https://x.com/billingnerd/status/1900000000000000001");
  assert.equal(mentions[3].authorHandle, "incidentfriend");
});

test("array fixtures pass through unchanged aside from sort order", () => {
  const mentions = normalizeMentionsResponse([
    {
      id: "2",
      text: "@cursorsupport second",
      authorId: "u2",
      authorHandle: "beta",
      createdAt: "2026-04-03T16:14:00.000Z",
      permalink: "https://x.com/beta/status/2",
      conversationId: "2",
      inReplyToUserId: null
    },
    {
      id: "1",
      text: "@cursorsupport first",
      authorId: "u1",
      authorHandle: "alpha",
      createdAt: "2026-04-03T16:10:00.000Z",
      permalink: "https://x.com/alpha/status/1",
      conversationId: "1",
      inReplyToUserId: null
    }
  ]);

  assert.equal(mentions[0].id, "1");
  assert.equal(mentions[1].id, "2");
});
