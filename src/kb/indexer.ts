import type { AppConfig } from "../config.ts";
import type {
  DemoDocumentSeed,
  KnowledgeChunk,
  KnowledgeDocument,
  KnowledgeIndex,
  RetrievedSource,
  SourceType
} from "../types.ts";
import { readJsonFile, writeJsonFile } from "../utils/fs.ts";
import { buildSnippet, clamp, countOccurrences, splitSupportDocIntoChunks, stableHash, tokenize } from "../utils/text.ts";
import { createEmbeddings } from "./embeddings.ts";
import { expandSupportSearchTokens } from "./query-rewrite.ts";

const SECTION_HINTS: Array<{ hintTokens: string[]; urlFragments: string[]; bonus: number }> = [
  {
    hintTokens: ["pricing", "billing", "refund", "invoice", "overage", "spend", "subscription", "plan"],
    urlFragments: ["/account-and-billing/", "/models-and-usage/usage-limits", "/models-and-usage/token-fee"],
    bonus: 18
  },
  {
    hintTokens: ["usage", "limit", "limits", "token", "premium", "model", "models"],
    urlFragments: ["/models-and-usage/", "/account-and-billing/overages"],
    bonus: 12
  },
  {
    hintTokens: ["bug", "error", "failing", "fails", "crash", "vpn", "network", "performance", "tab"],
    urlFragments: ["/troubleshooting/"],
    bonus: 18
  },
  {
    hintTokens: ["privacy", "security", "compliance", "region", "sso"],
    urlFragments: ["/security-and-privacy/"],
    bonus: 18
  },
  {
    hintTokens: ["login", "signin", "authentication", "verify", "verification", "connect", "connection", "ide", "editor"],
    urlFragments: ["/troubleshooting/", "/security-and-privacy/sso", "/getting-started/"],
    bonus: 18
  }
];

const BILLING_HINT_TOKENS = ["pricing", "billing", "refund", "invoice", "overage", "spend", "subscription", "plan", "charge", "charged"];
const ACCESS_HINT_TOKENS = ["login", "signin", "authentication", "verify", "verification", "connect", "connection", "ide", "editor"];

export function createDocumentFromSeed(seed: DemoDocumentSeed): KnowledgeDocument {
  return {
    id: stableHash(seed.url),
    url: seed.url,
    title: seed.title,
    text: seed.text,
    sourceType: seed.sourceType,
    fetchedAt: new Date().toISOString(),
    checksum: stableHash(seed.text),
    links: []
  };
}

export function inferSourceType(url: string): SourceType {
  const lower = url.toLowerCase();
  if (lower.includes("pricing") || lower.includes("rate-limits")) {
    return "pricing";
  }
  if (lower.includes("privacy") || lower.includes("security")) {
    return "policy";
  }
  if (lower.includes("faq")) {
    return "faq";
  }
  return "docs";
}

export function buildKnowledgeIndex(
  documents: KnowledgeDocument[],
  seedUrls: string[],
  chunkSize: number
): KnowledgeIndex {
  const chunks: KnowledgeChunk[] = [];

  for (const document of documents) {
    const sections = splitSupportDocIntoChunks(document.title, document.text, chunkSize);
    sections.forEach((section, index) => {
      chunks.push({
        id: `${document.id}:${index}`,
        documentId: document.id,
        url: document.url,
        title: document.title,
        text: section,
        position: index,
        tokens: Array.from(new Set(tokenize(`${document.title} ${section}`))),
        sourceType: document.sourceType,
        embedding: null
      });
    });
  }

  return {
    generatedAt: new Date().toISOString(),
    seedUrls,
    documents,
    chunks,
    embeddingModel: null,
    embeddingDimensions: null
  };
}

export async function saveKnowledgeIndex(config: AppConfig, index: KnowledgeIndex): Promise<void> {
  await writeJsonFile(config.kbIndexFile, index);
}

export async function loadKnowledgeIndex(config: AppConfig): Promise<KnowledgeIndex> {
  return readJsonFile<KnowledgeIndex>(config.kbIndexFile);
}

function buildChunkEmbeddingInput(chunk: Pick<KnowledgeChunk, "title" | "text">): string {
  return `${chunk.title}\n\n${chunk.text}`;
}

function hasEmbedding(chunk: Pick<KnowledgeChunk, "embedding">): boolean {
  return Array.isArray(chunk.embedding) && chunk.embedding.length > 0;
}

export function hasSemanticCoverage(index: KnowledgeIndex): boolean {
  return index.chunks.some(hasEmbedding);
}

export async function ensureKnowledgeIndexEmbeddings(
  config: AppConfig,
  index: KnowledgeIndex
): Promise<KnowledgeIndex> {
  if (!config.openAIKey || index.chunks.length === 0) {
    return index;
  }

  const targetDimensions = config.openAIEmbeddingDimensions;
  const metadataMatches =
    index.embeddingModel === config.openAIEmbeddingModel && index.embeddingDimensions === targetDimensions;

  const nextChunks = index.chunks.map((chunk) => ({
    ...chunk,
    embedding: metadataMatches ? chunk.embedding : null
  }));

  const missingIndexes = nextChunks
    .map((chunk, indexValue) => ({ chunk, indexValue }))
    .filter(({ chunk }) => !hasEmbedding(chunk))
    .map(({ indexValue }) => indexValue);

  if (missingIndexes.length === 0) {
    return index;
  }

  try {
    for (let start = 0; start < missingIndexes.length; start += config.kbEmbeddingBatchSize) {
      const batchIndexes = missingIndexes.slice(start, start + config.kbEmbeddingBatchSize);
      const inputs = batchIndexes.map((chunkIndex) => buildChunkEmbeddingInput(nextChunks[chunkIndex]));
      const embeddings = await createEmbeddings(config, inputs);

      if (embeddings.length !== inputs.length) {
        throw new Error(`Expected ${inputs.length} embeddings, received ${embeddings.length}.`);
      }

      embeddings.forEach((embedding, offset) => {
        nextChunks[batchIndexes[offset]] = {
          ...nextChunks[batchIndexes[offset]],
          embedding
        };
      });
    }
  } catch (error) {
    console.warn(`KB embedding warning: ${(error as Error).message}`);
    return index;
  }

  const inferredDimensions = nextChunks.find(hasEmbedding)?.embedding?.length || targetDimensions || null;
  return {
    ...index,
    generatedAt: new Date().toISOString(),
    chunks: nextChunks,
    embeddingModel: config.openAIEmbeddingModel,
    embeddingDimensions: inferredDimensions
  };
}

function scoreChunk(chunk: KnowledgeChunk, queryTokens: string[], rawQuery: string): number {
  const lowerText = chunk.text.toLowerCase();
  const lowerTitle = chunk.title.toLowerCase();
  const lowerUrl = chunk.url.toLowerCase();

  let score = 0;
  for (const token of queryTokens) {
    if (chunk.tokens.includes(token)) {
      score += 5;
    }
    score += countOccurrences(lowerText, token);
    if (lowerTitle.includes(token)) {
      score += 10;
    }
    if (lowerUrl.includes(token)) {
      score += 8;
    }
  }

  if (rawQuery && lowerText.includes(rawQuery.toLowerCase())) {
    score += 10;
  }

  for (const sectionHint of SECTION_HINTS) {
    if (
      sectionHint.hintTokens.some((token) => queryTokens.includes(token)) &&
      sectionHint.urlFragments.some((fragment) => lowerUrl.includes(fragment))
    ) {
      score += sectionHint.bonus;
    }
  }

  const isBillingUrl = lowerUrl.includes("/account-and-billing/");
  const looksLikeAccessIssue = ACCESS_HINT_TOKENS.some((token) => queryTokens.includes(token));
  const looksLikeBillingIssue = BILLING_HINT_TOKENS.some((token) => queryTokens.includes(token));
  if (isBillingUrl && looksLikeAccessIssue && !looksLikeBillingIssue) {
    score -= 16;
  }

  return score;
}

function dotProduct(left: number[], right: number[]): number {
  let total = 0;
  for (let indexValue = 0; indexValue < left.length; indexValue += 1) {
    total += left[indexValue] * right[indexValue];
  }
  return total;
}

function magnitude(vector: number[]): number {
  return Math.sqrt(dotProduct(vector, vector));
}

function cosineSimilarity(left: number[] | null, right: number[] | null): number {
  if (!left || !right || left.length === 0 || right.length === 0 || left.length !== right.length) {
    return 0;
  }

  const leftMagnitude = magnitude(left);
  const rightMagnitude = magnitude(right);
  if (leftMagnitude === 0 || rightMagnitude === 0) {
    return 0;
  }

  return dotProduct(left, right) / (leftMagnitude * rightMagnitude);
}

function buildRelevanceReason(
  chunk: KnowledgeChunk,
  queryTokens: string[],
  semanticScore: number | null
): string {
  const matched = queryTokens.filter((token) => chunk.tokens.includes(token)).slice(0, 4);

  if (semanticScore !== null && semanticScore >= 0.2 && matched.length > 0) {
    return `Semantic match plus terms: ${matched.join(", ")}.`;
  }

  if (semanticScore !== null && semanticScore >= 0.2) {
    return `Strong semantic match from ${chunk.title}.`;
  }

  if (matched.length === 0) {
    return `Top lexical match from ${chunk.title}.`;
  }

  return `Matches terms: ${matched.join(", ")}.`;
}

interface SearchOptions {
  queryEmbedding?: number[] | null;
  semanticWeight?: number;
}

export function searchKnowledgeIndex(
  index: KnowledgeIndex,
  query: string,
  limit = 3,
  options: SearchOptions = {}
): RetrievedSource[] {
  const queryTokens = expandSupportSearchTokens(Array.from(new Set(tokenize(query))), query);
  const semanticEnabled = Boolean(options.queryEmbedding && hasSemanticCoverage(index));
  if (queryTokens.length === 0 && !semanticEnabled) {
    return [];
  }

  const semanticWeight = semanticEnabled ? clamp(options.semanticWeight ?? 0.65, 0, 1) : 0;
  const lexicalWeight = 1 - semanticWeight;

  const scored = index.chunks.map((chunk) => {
    const lexicalScore = queryTokens.length > 0 ? scoreChunk(chunk, queryTokens, query) : 0;
    const semanticScore = semanticEnabled
      ? clamp(cosineSimilarity(options.queryEmbedding || null, chunk.embedding), 0, 1)
      : null;

    return {
      chunk,
      lexicalScore,
      semanticScore
    };
  });

  const maxLexicalScore = scored.reduce((current, item) => Math.max(current, item.lexicalScore), 0);

  const ranked = scored
    .map((item) => {
      const lexicalNormalized = maxLexicalScore > 0 ? item.lexicalScore / maxLexicalScore : 0;
      const combinedScore = semanticEnabled
        ? lexicalNormalized * lexicalWeight + (item.semanticScore || 0) * semanticWeight
        : item.lexicalScore;

      return {
        ...item,
        combinedScore
      };
    })
    .filter((item) => {
      if (!semanticEnabled) {
        return item.lexicalScore > 0;
      }
      return item.lexicalScore > 0 || (item.semanticScore || 0) >= 0.2;
    })
    .sort(
      (left, right) =>
        right.combinedScore - left.combinedScore ||
        right.lexicalScore - left.lexicalScore ||
        left.chunk.position - right.chunk.position
    );

  const deduped: RetrievedSource[] = [];
  const seenUrls = new Set<string>();

  for (const item of ranked) {
    if (seenUrls.has(item.chunk.url)) {
      continue;
    }
    seenUrls.add(item.chunk.url);

    deduped.push({
      title: item.chunk.title,
      url: item.chunk.url,
      snippet: buildSnippet(item.chunk.text, queryTokens),
      relevanceScore: semanticEnabled ? Number((item.combinedScore * 100).toFixed(2)) : item.lexicalScore,
      relevanceReason: buildRelevanceReason(item.chunk, queryTokens, item.semanticScore),
      sourceType: item.chunk.sourceType
    });

    if (deduped.length >= limit) {
      break;
    }
  }

  return deduped;
}
