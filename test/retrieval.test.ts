import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createDocumentFromSeed, buildKnowledgeIndex, searchKnowledgeIndex } from "../src/kb/indexer.ts";
import { rewriteQueryHeuristically } from "../src/kb/query-rewrite.ts";
import { rerankRetrievedSources } from "../src/kb/rerank.ts";
import type { DemoDocumentSeed } from "../src/types.ts";
import { splitSupportDocIntoChunks } from "../src/utils/text.ts";
import { loadConfig } from "../src/config.ts";

const demoSeedPath = new URL("../fixtures/kb/help-center-documents.json", import.meta.url);

async function loadDemoIndex() {
  const seeds = JSON.parse(await readFile(demoSeedPath, "utf8")) as DemoDocumentSeed[];
  return buildKnowledgeIndex(
    seeds.map(createDocumentFromSeed),
    seeds.map((seed) => seed.url),
    1200
  );
}

test("retrieval returns pricing docs for billing questions", async () => {
  const index = await loadDemoIndex();
  const results = searchKnowledgeIndex(index, "Where do I check pricing and usage limits?");

  assert.ok(results.length > 0);
  assert.ok(
    [
      "https://cursor.com/help/account-and-billing/pricing",
      "https://cursor.com/help/models-and-usage/usage-limits"
    ].includes(results[0].url)
  );
});

test("retrieval returns troubleshooting guidance for vpn failures", async () => {
  const index = await loadDemoIndex();
  const results = searchKnowledgeIndex(index, "Cursor failing behind company VPN");

  assert.ok(results.length > 0);
  assert.equal(results[0].url, "https://cursor.com/help/troubleshooting/network");
});

test("retrieval can use semantic similarity when chunk embeddings are present", () => {
  const index = buildKnowledgeIndex(
    [
      createDocumentFromSeed({
        url: "https://cursor.com/help/account-and-billing/cancel",
        title: "Cancel your subscription",
        text: "End recurring billing from the dashboard.",
        sourceType: "pricing"
      }),
      createDocumentFromSeed({
        url: "https://cursor.com/help/troubleshooting/network",
        title: "Network and proxy",
        text: "Troubleshoot VPN, proxy, and firewall issues.",
        sourceType: "docs"
      })
    ],
    ["https://cursor.com/help"],
    1200
  );

  const semanticIndex = {
    ...index,
    embeddingModel: "text-embedding-3-small",
    embeddingDimensions: 2,
    chunks: index.chunks.map((chunk) => ({
      ...chunk,
      embedding: chunk.url.includes("/cancel") ? [1, 0] : [0, 1]
    }))
  };

  const results = searchKnowledgeIndex(semanticIndex, "i already turned this off last month", 3, {
    queryEmbedding: [1, 0],
    semanticWeight: 0.8
  });

  assert.ok(results.length > 0);
  assert.equal(results[0].url, "https://cursor.com/help/account-and-billing/cancel");
  assert.ok(results[0].relevanceReason.toLowerCase().includes("semantic"));
});

test("retrieval prefers troubleshooting or auth docs for sign-in issues", async () => {
  const index = await loadDemoIndex();
  const results = searchKnowledgeIndex(index, "can't connect in the IDE when i try to sign in");

  assert.ok(results.length > 0);
  assert.ok(
    results.slice(0, 3).some((result) =>
      [
        "https://cursor.com/help/troubleshooting/install-issues",
        "https://cursor.com/help/security-and-privacy/sso",
        "https://cursor.com/help/troubleshooting/network"
      ].includes(result.url)
    )
  );
});

test("faq chunking splits a help article at question boundaries", async () => {
  const seeds = JSON.parse(await readFile(demoSeedPath, "utf8")) as DemoDocumentSeed[];
  const cancelDoc = seeds.find((seed) => seed.url === "https://cursor.com/help/account-and-billing/cancel");

  assert.ok(cancelDoc);
  const chunks = splitSupportDocIntoChunks(cancelDoc.title, cancelDoc.text, 1200);

  assert.ok(chunks.length >= 4);
  assert.ok(chunks.some((chunk) => chunk.startsWith("How do I cancel my subscription?")));
  assert.ok(chunks.some((chunk) => chunk.startsWith("What happens after I cancel my subscription?")));
});

test("heuristic query rewrite expands support shorthand into retrieval terms", () => {
  const rewritten = rewriteQueryHeuristically("i turned it off already so why am i still paying for this");

  assert.ok(rewritten.includes("cancel"));
  assert.ok(rewritten.includes("subscription"));
  assert.ok(rewritten.includes("billing") || rewritten.includes("charge"));
});

test("heuristic query rewrite expands sign-in issues without inventing billing terms", () => {
  const rewritten = rewriteQueryHeuristically("i can't connect in the ide when i try to sign in");

  assert.ok(rewritten.includes("login") || rewritten.includes("authentication"));
  assert.ok(rewritten.includes("ide") || rewritten.includes("editor"));
  assert.ok(!rewritten.includes("billing"));
});

test("reranker can reorder retrieved candidates", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        output_text: "{\"ordered_indexes\":[1,0,2]}"
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json"
        }
      }
    ) as typeof fetch;

  try {
    const config = loadConfig({
      ...process.env,
      OPENAI_API_KEY: "test-key",
      OPENAI_MODEL: "gpt-5.4-nano"
    });

    const reranked = await rerankRetrievedSources(
      config,
      {
        id: "m1",
        text: "@cursorsupport why was i charged after canceling?",
        authorId: "u1",
        authorHandle: "billingnerd",
        createdAt: "2026-04-03T18:00:00.000Z",
        permalink: "https://x.com/billingnerd/status/m1",
        conversationId: "m1",
        inReplyToUserId: null
      },
      "charged cancel billing subscription",
      [
        {
          title: "Usage-based charges",
          url: "https://cursor.com/help/account-and-billing/overages",
          snippet: "Overage billing details.",
          relevanceScore: 52,
          relevanceReason: "Matches terms: billing.",
          sourceType: "pricing"
        },
        {
          title: "Cancel your subscription",
          url: "https://cursor.com/help/account-and-billing/cancel",
          snippet: "You won't be charged again after canceling.",
          relevanceScore: 50,
          relevanceReason: "Matches terms: cancel, charged.",
          sourceType: "pricing"
        },
        {
          title: "Billing and payments",
          url: "https://cursor.com/help/account-and-billing/billing",
          snippet: "General billing help.",
          relevanceScore: 48,
          relevanceReason: "Matches terms: billing.",
          sourceType: "pricing"
        }
      ]
    );

    assert.equal(reranked[0].url, "https://cursor.com/help/account-and-billing/cancel");
    assert.equal(reranked[1].url, "https://cursor.com/help/account-and-billing/overages");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
