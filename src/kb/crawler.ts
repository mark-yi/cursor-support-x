import { join } from "node:path";
import { readdir, rm } from "node:fs/promises";
import type { AppConfig } from "../config.ts";
import type { DemoDocumentSeed, KnowledgeDocument, KnowledgeIndex } from "../types.ts";
import { ensureDir, readJsonFile, writeJsonFile } from "../utils/fs.ts";
import {
  extractCanonicalUrl,
  extractLinks,
  extractTitle,
  normalizeWhitespace,
  slugify,
  stableHash,
  stripHtml
} from "../utils/text.ts";
import { buildKnowledgeIndex, createDocumentFromSeed, ensureKnowledgeIndexEmbeddings, inferSourceType, saveKnowledgeIndex } from "./indexer.ts";

function normalizeCursorUrl(value: string): string {
  const url = new URL(value);
  url.hash = "";
  if (url.hostname === "www.cursor.com") {
    url.hostname = "cursor.com";
  }
  return url.toString().replace(/\/$/, "") || url.toString();
}

function isAllowedUrl(config: AppConfig, value: string): boolean {
  try {
    const url = new URL(value);
    if (!config.kbAllowedHosts.has(url.hostname)) {
      return false;
    }
    return config.kbAllowedPathPrefixes.some((prefix) => url.pathname === prefix || url.pathname.startsWith(`${prefix}/`));
  } catch {
    return false;
  }
}

function createDocument(url: string, html: string): KnowledgeDocument {
  const canonicalUrl = normalizeCursorUrl(extractCanonicalUrl(html, url));
  const title = extractTitle(html) || canonicalUrl;
  const text = stripHtml(html);
  const links = extractLinks(html, canonicalUrl).map(normalizeCursorUrl);

  return {
    id: stableHash(canonicalUrl),
    url: canonicalUrl,
    title: normalizeWhitespace(title),
    text,
    sourceType: inferSourceType(canonicalUrl),
    fetchedAt: new Date().toISOString(),
    checksum: stableHash(text),
    links
  };
}

async function clearPersistedDocuments(config: AppConfig): Promise<void> {
  await ensureDir(config.kbDocumentsDir);
  const existingFiles = await readdir(config.kbDocumentsDir).catch(() => []);

  for (const relativePath of existingFiles) {
    if (!relativePath.endsWith(".json")) {
      continue;
    }
    await rm(join(config.kbDocumentsDir, relativePath), { force: true });
  }
}

async function persistDocuments(config: AppConfig, documents: KnowledgeDocument[]): Promise<void> {
  await clearPersistedDocuments(config);

  const filenames: string[] = [];
  for (const document of documents) {
    const filename = `${slugify(document.title) || "document"}-${document.id.slice(0, 8)}.json`;
    filenames.push(filename);
    await writeJsonFile(join(config.kbDocumentsDir, filename), document);
  }

  await writeJsonFile(join(config.kbDocumentsDir, ".index.json"), filenames);
}

async function fetchDocumentWithRetry(config: AppConfig, url: string): Promise<KnowledgeDocument | null> {
  let attempt = 0;

  while (attempt < config.kbMaxRetries) {
    if (attempt > 0) {
      const backoffMs = config.kbRequestDelayMs * Math.pow(2, attempt);
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
    }

    const response = await fetch(url, {
      headers: {
        "User-Agent": "cursor-support-x-demo/0.1",
        Accept: "text/html,application/xhtml+xml"
      }
    });

    if (response.ok) {
      const contentType = response.headers.get("content-type") || "";
      if (!contentType.includes("text/html")) {
        return null;
      }

      const html = await response.text();
      return createDocument(url, html);
    }

    if (response.status !== 429 && response.status < 500) {
      throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
    }

    attempt += 1;
    if (attempt >= config.kbMaxRetries) {
      throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
    }
  }

  return null;
}

export async function syncKnowledgeBase(config: AppConfig): Promise<KnowledgeIndex> {
  const queue = [...config.kbSeedUrls];
  const visited = new Set<string>();
  const documents: KnowledgeDocument[] = [];

  while (queue.length > 0 && documents.length < config.kbMaxPages) {
    const nextUrl = normalizeCursorUrl(queue.shift() as string);
    if (visited.has(nextUrl) || !isAllowedUrl(config, nextUrl)) {
      continue;
    }
    visited.add(nextUrl);

    try {
      const document = await fetchDocumentWithRetry(config, nextUrl);
      if (!document || !document.text) {
        continue;
      }

      documents.push(document);
      for (const link of document.links) {
        if (!visited.has(link) && isAllowedUrl(config, link)) {
          queue.push(link);
        }
      }

      if (config.kbRequestDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, config.kbRequestDelayMs));
      }
    } catch (error) {
      console.warn(`KB fetch warning for ${nextUrl}: ${(error as Error).message}`);
    }
  }

  if (documents.length < 20) {
    console.warn(
      `KB sync only fetched ${documents.length} help pages from the live site. Falling back to the bundled help-center snapshot.`
    );
    return seedDemoKnowledgeBase(config);
  }

  const baseIndex = buildKnowledgeIndex(documents, config.kbSeedUrls, config.kbChunkSize);
  const index = await ensureKnowledgeIndexEmbeddings(config, baseIndex);
  await persistDocuments(config, documents);
  await saveKnowledgeIndex(config, index);
  return index;
}

export async function seedDemoKnowledgeBase(config: AppConfig): Promise<KnowledgeIndex> {
  const seeds = await readJsonFile<DemoDocumentSeed[]>(config.kbDemoCorpusFile);
  const documents = seeds.map(createDocumentFromSeed);
  const baseIndex = buildKnowledgeIndex(documents, config.kbSeedUrls, config.kbChunkSize);
  const index = await ensureKnowledgeIndexEmbeddings(config, baseIndex);
  await persistDocuments(config, documents);
  await saveKnowledgeIndex(config, index);
  return index;
}
