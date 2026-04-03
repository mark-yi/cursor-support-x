import { join } from "node:path";
import { loadConfig } from "./config.ts";
import { seedDemoKnowledgeBase, syncKnowledgeBase } from "./kb/crawler.ts";
import { ensureKnowledgeIndexEmbeddings, loadKnowledgeIndex, saveKnowledgeIndex } from "./kb/indexer.ts";
import { applyProcessedMentions, loadMentionState, saveMentionState } from "./state.ts";
import type { SupportMention } from "./types.ts";
import { fileExists, readJsonFile, writeJsonFile } from "./utils/fs.ts";
import { slugify } from "./utils/text.ts";
import { buildSupportPayload } from "./triage/pipeline.ts";
import { fetchMentions, loadMentionsFromFixture } from "./x/api.ts";
import { buildMentionPermalink } from "./x/api.ts";

interface FinalDemoCase {
  id: string;
  handle: string;
  scenario: string;
  text: string;
  createdAt: string;
}

interface FinalDemoCaseSet {
  version: string;
  purpose: string;
  cases: FinalDemoCase[];
}

function parseArgs(argv: string[]): { command: string; options: Map<string, string | true> } {
  const [command = "help", ...rest] = argv;
  const options = new Map<string, string | true>();

  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token.startsWith("--")) {
      continue;
    }

    const key = token.slice(2);
    const next = rest[index + 1];
    if (next && !next.startsWith("--")) {
      options.set(key, next);
      index += 1;
    } else {
      options.set(key, true);
    }
  }

  return { command, options };
}

function printUsage(): void {
  console.log(`
Commands:
  kb:sync                 Crawl official Cursor docs and pricing pages into data/kb
  kb:seed-demo            Seed a local demo knowledge base from fixture documents
  mentions:poll           Poll X mentions once, process them, and write Slack-ready JSON
  mentions:watch          Poll X mentions repeatedly using X_POLL_INTERVAL_MS
  demo:fixtures           Seed the demo KB and process the fixture mention payload
  demo:final              Seed the demo KB and generate the curated example outputs
  demo:message            Process one arbitrary mock mention and write Slack-ready JSON

Useful flags:
  --fixture <path>        Load mentions from a fixture file instead of live X
  --limit <n>             Limit how many new mentions are processed in one run
  --text <message>        Mock mention text for demo:message
  --handle <username>     Mock X handle for demo:message
  --id <id>               Mock tweet id for demo:message
  --permalink <url>       Override generated post permalink for demo:message
`);
}

async function ensureKnowledgeBase(command: string): Promise<void> {
  const config = loadConfig();
  const hasIndex = await fileExists(config.kbIndexFile);
  if (!hasIndex) {
    if (
      command === "mentions:poll" ||
      command === "mentions:watch" ||
      command === "demo:message" ||
      command === "demo:final"
    ) {
      console.log("No knowledge base found. Seeding the local demo corpus first.");
      await seedDemoKnowledgeBase(config);
    }
  }
}

async function writePayload(payload: unknown, baseDir: string, mention: SupportMention): Promise<string> {
  const filename = `${mention.createdAt.slice(0, 10)}-${slugify(mention.authorHandle)}-${mention.id}.json`;
  const path = join(baseDir, filename);
  await writeJsonFile(path, payload);
  return path;
}

async function loadMentions(
  fixture: string | null,
  sinceId: string | null
): Promise<SupportMention[]> {
  const config = loadConfig();
  if (fixture) {
    return loadMentionsFromFixture(fixture);
  }
  return fetchMentions(config, sinceId);
}

async function loadSearchReadyKnowledgeIndex() {
  const config = loadConfig();
  const index = await loadKnowledgeIndex(config);
  const hydratedIndex = await ensureKnowledgeIndexEmbeddings(config, index);
  if (hydratedIndex !== index) {
    await saveKnowledgeIndex(config, hydratedIndex);
  }
  return hydratedIndex;
}

async function processMentionsOnce(options: Map<string, string | true>): Promise<void> {
  const config = loadConfig();
  await ensureKnowledgeBase("mentions:poll");
  const index = await loadSearchReadyKnowledgeIndex();
  const state = await loadMentionState(config);
  const fixturePath = typeof options.get("fixture") === "string" ? String(options.get("fixture")) : null;
  const limit = typeof options.get("limit") === "string" ? Number(options.get("limit")) : Infinity;

  const mentions = await loadMentions(fixturePath, state.lastSeenMentionId);
  const processedSet = new Set(state.processedMentionIds);
  const freshMentions = mentions.filter((mention) => !processedSet.has(mention.id)).slice(0, limit);

  if (freshMentions.length === 0) {
    console.log("No new mentions to process.");
    return;
  }

  for (const mention of freshMentions) {
    const payload = await buildSupportPayload(config, index, mention);
    const outputPath = await writePayload(payload, config.outputsDir, mention);
    console.log(`Wrote ${outputPath}`);
  }

  await saveMentionState(config, applyProcessedMentions(state, freshMentions));
}

async function watchMentions(): Promise<void> {
  const config = loadConfig();
  await ensureKnowledgeBase("mentions:watch");

  while (true) {
    await processMentionsOnce(new Map());
    console.log(`Sleeping for ${config.xPollIntervalMs}ms...`);
    await new Promise((resolve) => setTimeout(resolve, config.xPollIntervalMs));
  }
}

async function runFixtureDemo(): Promise<void> {
  const config = loadConfig();
  await seedDemoKnowledgeBase(config);
  const options = new Map<string, string | true>([["fixture", config.xFixtureFile]]);
  await processMentionsOnce(options);
}

function getStringOption(options: Map<string, string | true>, key: string): string | null {
  const value = options.get(key);
  return typeof value === "string" ? value : null;
}

function buildDemoMention(options: Map<string, string | true>): SupportMention {
  const text = getStringOption(options, "text");
  if (!text) {
    throw new Error("demo:message requires --text.");
  }

  const createdAt = new Date().toISOString();
  const handle = getStringOption(options, "handle") || "mockuser";
  const id = getStringOption(options, "id") || `${Date.now()}`;
  const permalink = getStringOption(options, "permalink") || buildMentionPermalink(handle, id);

  return {
    id,
    text,
    authorId: getStringOption(options, "author-id") || handle,
    authorHandle: handle,
    createdAt,
    permalink,
    conversationId: id,
    inReplyToUserId: null
  };
}

function buildMentionFromFinalDemoCase(testCase: FinalDemoCase): SupportMention {
  return {
    id: testCase.id,
    text: testCase.text,
    authorId: testCase.handle,
    authorHandle: testCase.handle,
    createdAt: testCase.createdAt,
    permalink: buildMentionPermalink(testCase.handle, testCase.id),
    conversationId: testCase.id,
    inReplyToUserId: null
  };
}

async function loadFinalDemoCases(config = loadConfig()): Promise<FinalDemoCaseSet> {
  return readJsonFile<FinalDemoCaseSet>(join(config.rootDir, "fixtures", "demo", "final-demo-cases.json"));
}

async function runMessageDemo(options: Map<string, string | true>): Promise<void> {
  const config = loadConfig();
  await ensureKnowledgeBase("demo:message");
  const index = await loadSearchReadyKnowledgeIndex();
  const mention = buildDemoMention(options);
  const payload = await buildSupportPayload(config, index, mention);
  const outputPath = await writePayload(payload, config.outputsDir, mention);

  console.log(`Wrote ${outputPath}`);
  console.log(payload.slack_message);
}

async function runFinalDemo(): Promise<void> {
  const config = loadConfig();
  await seedDemoKnowledgeBase(config);
  const index = await loadSearchReadyKnowledgeIndex();
  const demoCases = await loadFinalDemoCases(config);
  const examplesDir = join(config.rootDir, "examples", "outputs");

  for (const testCase of demoCases.cases) {
    const mention = buildMentionFromFinalDemoCase(testCase);
    const payload = await buildSupportPayload(config, index, mention);
    const outputPath = join(examplesDir, `${testCase.id}.json`);
    await writeJsonFile(outputPath, payload);
    console.log(`Wrote ${outputPath}`);
  }
}

async function main(): Promise<void> {
  const { command, options } = parseArgs(process.argv.slice(2));
  const config = loadConfig();

  switch (command) {
    case "kb:sync": {
      const index = await syncKnowledgeBase(config);
      console.log(`Indexed ${index.documents.length} documents into ${config.kbIndexFile}`);
      return;
    }
    case "kb:seed-demo": {
      const index = await seedDemoKnowledgeBase(config);
      console.log(`Seeded demo corpus with ${index.documents.length} documents.`);
      return;
    }
    case "mentions:poll":
      await processMentionsOnce(options);
      return;
    case "mentions:watch":
      await watchMentions();
      return;
    case "demo:fixtures":
      await runFixtureDemo();
      return;
    case "demo:final":
      await runFinalDemo();
      return;
    case "demo:message":
      await runMessageDemo(options);
      return;
    case "help":
    default:
      printUsage();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
