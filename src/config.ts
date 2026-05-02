import { join } from "node:path";
import { existsSync, readFileSync } from "node:fs";

export interface AppConfig {
  rootDir: string;
  dataDir: string;
  kbDir: string;
  kbDocumentsDir: string;
  kbIndexFile: string;
  outputsDir: string;
  mentionsStateFile: string;
  kbDemoCorpusFile: string;
  xFixtureFile: string;
  kbSeedUrls: string[];
  kbAllowedHosts: Set<string>;
  kbAllowedPathPrefixes: string[];
  kbMaxPages: number;
  kbChunkSize: number;
  kbRequestDelayMs: number;
  kbMaxRetries: number;
  xApiBaseUrl: string;
  xBearerToken: string | null;
  xUserAccessToken: string | null;
  xUsername: string;
  xUserId: string | null;
  xPollIntervalMs: number;
  openAIEmbeddingsBaseUrl: string;
  openAIEmbeddingModel: string;
  openAIEmbeddingDimensions: number | null;
  openAIBaseUrl: string;
  openAIKey: string | null;
  openAIModel: string;
  openAIReasoningEffort: "minimal" | "low" | "medium" | "high";
  kbEmbeddingBatchSize: number;
  retrievalSemanticWeight: number;
}

function parseDotEnvValue(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith("\"") && trimmed.endsWith("\"")) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }

  return trimmed;
}

function loadDotEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const rootDir = env.APP_ROOT || process.cwd();
  const envPath = join(rootDir, ".env");
  if (!existsSync(envPath)) {
    return env;
  }

  const merged = { ...env };
  const shellKeys = new Set(Object.keys(env));
  const content = readFileSync(envPath, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const equalsIndex = trimmed.indexOf("=");
    if (equalsIndex <= 0) {
      continue;
    }

    const key = trimmed.slice(0, equalsIndex).trim().replace(/^export\s+/, "");
    const value = parseDotEnvValue(trimmed.slice(equalsIndex + 1));
    if (!shellKeys.has(key) && (!merged[key] || value)) {
      merged[key] = value;
    }
  }

  return merged;
}

export function loadConfig(env = process.env): AppConfig {
  env = loadDotEnv(env);
  const rootDir = env.APP_ROOT || process.cwd();
  const dataDir = join(rootDir, "data");

  return {
    rootDir,
    dataDir,
    kbDir: join(dataDir, "kb"),
    kbDocumentsDir: join(dataDir, "kb", "documents"),
    kbIndexFile: join(dataDir, "kb", "index.json"),
    outputsDir: join(dataDir, "outputs"),
    mentionsStateFile: join(dataDir, "mentions-state.json"),
    kbDemoCorpusFile: join(rootDir, "fixtures", "kb", "help-center-documents.json"),
    xFixtureFile: join(rootDir, "fixtures", "x", "mentions-response.json"),
    kbSeedUrls: [
      "https://cursor.com/help"
    ],
    kbAllowedHosts: new Set(["cursor.com", "www.cursor.com"]),
    kbAllowedPathPrefixes: ["/help"],
    kbMaxPages: Number(env.KB_MAX_PAGES || "120"),
    kbChunkSize: Number(env.KB_CHUNK_SIZE || "1200"),
    kbRequestDelayMs: Number(env.KB_REQUEST_DELAY_MS || "200"),
    kbMaxRetries: Number(env.KB_MAX_RETRIES || "3"),
    xApiBaseUrl: env.X_API_BASE_URL || "https://api.x.com/2",
    xBearerToken: env.X_BEARER_TOKEN || null,
    xUserAccessToken: env.X_USER_ACCESS_TOKEN || null,
    xUsername: env.X_USERNAME || "cursorsupport",
    xUserId: env.X_USER_ID || null,
    xPollIntervalMs: Number(env.X_POLL_INTERVAL_MS || "60000"),
    openAIEmbeddingsBaseUrl: env.OPENAI_EMBEDDINGS_BASE_URL || "https://api.openai.com/v1/embeddings",
    openAIEmbeddingModel: env.OPENAI_EMBEDDING_MODEL || "text-embedding-3-small",
    openAIEmbeddingDimensions: env.OPENAI_EMBEDDING_DIMENSIONS ? Number(env.OPENAI_EMBEDDING_DIMENSIONS) : null,
    openAIBaseUrl: env.OPENAI_BASE_URL || "https://api.openai.com/v1/responses",
    openAIKey: env.OPENAI_API_KEY || null,
    openAIModel: env.OPENAI_MODEL || "gpt-5.4-nano",
    openAIReasoningEffort: (env.OPENAI_REASONING_EFFORT as AppConfig["openAIReasoningEffort"]) || "medium",
    kbEmbeddingBatchSize: Number(env.KB_EMBEDDING_BATCH_SIZE || "32"),
    retrievalSemanticWeight: Number(env.RETRIEVAL_SEMANTIC_WEIGHT || "0.65")
  };
}
