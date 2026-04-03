import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildSupportPayload } from "../src/triage/pipeline.ts";
import { loadConfig } from "../src/config.ts";
import { buildKnowledgeIndex, createDocumentFromSeed } from "../src/kb/indexer.ts";
import type { DemoDocumentSeed, SupportMention } from "../src/types.ts";

const demoSeedPath = new URL("../fixtures/kb/help-center-documents.json", import.meta.url);

async function loadDemoIndex() {
  const seeds = JSON.parse(await readFile(demoSeedPath, "utf8")) as DemoDocumentSeed[];
  return buildKnowledgeIndex(
    seeds.map(createDocumentFromSeed),
    seeds.map((seed) => seed.url),
    1200
  );
}

test("pipeline produces citation-backed payloads for supported questions", async () => {
  const config = loadConfig({ ...process.env, OPENAI_API_KEY: "" });
  const index = await loadDemoIndex();
  const mention: SupportMention = {
    id: "1",
    text: "@cursorsupport where do I check official pricing?",
    authorId: "u1",
    authorHandle: "billingnerd",
    createdAt: "2026-04-03T16:10:00.000Z",
    permalink: "https://x.com/billingnerd/status/1",
    conversationId: "1",
    inReplyToUserId: null
  };

  const payload = await buildSupportPayload(config, index, mention);

  assert.equal(payload.model.mode, "heuristic");
  assert.equal(payload.triage.category, "billing/pricing");
  assert.ok(payload.sources.length > 0);
  assert.ok(payload.suggested_response.length > 0);
  assert.ok(payload.suggested_reply.includes("https://cursor.com/help/"));
  assert.equal(payload.fallback, null);
  assert.ok(payload.retrieval_debug.rewritten_query.length > 0);
  assert.equal(payload.retrieval_debug.retrieval_mode, "lexical");
  assert.ok(payload.retrieval_debug.top_candidates_before_rerank.length > 0);
  assert.ok(payload.retrieval_debug.top_candidates_after_rerank.length > 0);
  assert.equal(payload.slack_fields.new_mention, mention.text);
  assert.equal(payload.slack_fields.link_to_post, mention.permalink);
  assert.ok(payload.slack_fields.sources.includes("https://cursor.com/help/"));
  assert.ok(payload.slack_message.startsWith(`new mention: ${mention.text}`));
  assert.ok(payload.slack_message.includes(`suggested response: ${payload.suggested_response}`));
  assert.ok(payload.slack_message.includes(`suggested reply: ${payload.suggested_reply}`));
  assert.ok(payload.slack_message.includes(`link to post: ${mention.permalink}`));
});

test("pipeline escalates when the corpus is weak", async () => {
  const config = loadConfig({ ...process.env, OPENAI_API_KEY: "" });
  const index = await loadDemoIndex();
  const mention: SupportMention = {
    id: "2",
    text: "@cursorsupport do you offer a phone number for enterprise incidents?",
    authorId: "u2",
    authorHandle: "incidentfriend",
    createdAt: "2026-04-03T16:24:00.000Z",
    permalink: "https://x.com/incidentfriend/status/2",
    conversationId: "2",
    inReplyToUserId: null
  };

  const payload = await buildSupportPayload(config, index, mention);

  assert.equal(payload.triage.needs_human_review, true);
  assert.ok(payload.fallback);
  assert.ok(payload.fallback?.manual_next_step.includes("hi@cursor.com"));
  assert.ok(payload.slack_message.includes("sources: "));
});

test("billing disputes route to hi@cursor.com instead of DM", async () => {
  const config = loadConfig({ ...process.env, OPENAI_API_KEY: "" });
  const index = await loadDemoIndex();
  const mention: SupportMention = {
    id: "3",
    text: "@cursorsupport wtf you charged me for april even tho i canceled my subscription",
    authorId: "u3",
    authorHandle: "angrytester",
    createdAt: "2026-04-03T17:00:00.000Z",
    permalink: "https://x.com/angrytester/status/3",
    conversationId: "3",
    inReplyToUserId: null
  };

  const payload = await buildSupportPayload(config, index, mention);

  assert.equal(payload.triage.category, "billing/pricing");
  assert.ok(payload.suggested_response.includes("hi@cursor.com"));
  assert.ok(payload.suggested_response.toLowerCase().includes("in dm"));
  assert.ok(payload.suggested_reply.includes("hi@cursor.com"));
});

test("refund requests route to hi@cursor.com instead of DM", async () => {
  const config = loadConfig({ ...process.env, OPENAI_API_KEY: "" });
  const index = await loadDemoIndex();
  const mention: SupportMention = {
    id: "refund-1",
    text: "@cursorsupport i want a refund for last month can someone fix this",
    authorId: "u5",
    authorHandle: "refundpal",
    createdAt: "2026-04-03T17:03:00.000Z",
    permalink: "https://x.com/refundpal/status/refund-1",
    conversationId: "refund-1",
    inReplyToUserId: null
  };

  const payload = await buildSupportPayload(config, index, mention);

  assert.equal(payload.triage.category, "billing/pricing");
  assert.ok(payload.suggested_response.includes("hi@cursor.com"));
  assert.ok(!payload.suggested_response.toLowerCase().includes("dm is fine"));
  assert.ok(payload.suggested_reply.includes("https://cursor.com/help/account-and-billing/refunds"));
  assert.ok(payload.suggested_reply.includes("hi@cursor.com"));
});

test("small personal-account issues can offer DM follow-up", async () => {
  const config = loadConfig({ ...process.env, OPENAI_API_KEY: "" });
  const index = await loadDemoIndex();
  const mention: SupportMention = {
    id: "4",
    text: "@cursorsupport how do i change the email on my personal account?",
    authorId: "u4",
    authorHandle: "personalacct",
    createdAt: "2026-04-03T17:08:00.000Z",
    permalink: "https://x.com/personalacct/status/4",
    conversationId: "4",
    inReplyToUserId: null
  };

  const payload = await buildSupportPayload(config, index, mention);

  assert.equal(payload.triage.category, "account/access");
  assert.ok(payload.suggested_response.includes("DM is fine"));
  assert.ok(payload.suggested_reply.includes("DM us"));
});

test("login-access issues route to hi@cursor.com instead of DM", async () => {
  const config = loadConfig({ ...process.env, OPENAI_API_KEY: "" });
  const index = await loadDemoIndex();
  const mention: SupportMention = {
    id: "5",
    text: "@cursorsupport i can't sign in and my verification code never shows up",
    authorId: "u6",
    authorHandle: "lockedoutdev",
    createdAt: "2026-04-03T17:12:00.000Z",
    permalink: "https://x.com/lockedoutdev/status/5",
    conversationId: "5",
    inReplyToUserId: null
  };

  const payload = await buildSupportPayload(config, index, mention);

  assert.equal(payload.triage.category, "account/access");
  assert.equal(payload.triage.needs_human_review, true);
  assert.ok(payload.suggested_response.includes("hi@cursor.com"));
  assert.ok(!payload.suggested_response.includes("DM is fine"));
  assert.ok(payload.suggested_reply.includes("hi@cursor.com"));
});

test("weak bug reports ask for repro details over email", async () => {
  const config = loadConfig({ ...process.env, OPENAI_API_KEY: "" });
  const index = await loadDemoIndex();
  const mention: SupportMention = {
    id: "6",
    text: "@cursorsupport the app is broken and keeps crashing every time i open a repo",
    authorId: "u7",
    authorHandle: "crashfriend",
    createdAt: "2026-04-03T17:19:00.000Z",
    permalink: "https://x.com/crashfriend/status/6",
    conversationId: "6",
    inReplyToUserId: null
  };

  const payload = await buildSupportPayload(config, index, mention);

  assert.equal(payload.triage.category, "bugs/incidents");
  assert.equal(payload.triage.needs_human_review, true);
  assert.ok(payload.suggested_response.includes("OS, Cursor version, exact error, and repro steps"));
  assert.ok(payload.suggested_reply.includes("hi@cursor.com"));
  assert.ok(payload.suggested_reply.includes("OS, Cursor version, exact error, and repro steps"));
});
