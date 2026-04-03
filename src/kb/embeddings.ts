import type { AppConfig } from "../config.ts";

interface EmbeddingDatum {
  embedding?: number[];
  index?: number;
}

interface EmbeddingsResponse {
  data?: EmbeddingDatum[];
}

function sortByIndex(data: EmbeddingDatum[]): EmbeddingDatum[] {
  return [...data].sort((left, right) => (left.index || 0) - (right.index || 0));
}

export async function createEmbeddings(config: AppConfig, inputs: string[]): Promise<number[][]> {
  if (!config.openAIKey) {
    return [];
  }

  if (inputs.length === 0) {
    return [];
  }

  const response = await fetch(config.openAIEmbeddingsBaseUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.openAIKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      input: inputs,
      model: config.openAIEmbeddingModel,
      encoding_format: "float",
      ...(config.openAIEmbeddingDimensions ? { dimensions: config.openAIEmbeddingDimensions } : {})
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Embedding request failed: ${response.status} ${response.statusText}${errorText ? ` - ${errorText}` : ""}`);
  }

  const payload = (await response.json()) as EmbeddingsResponse;
  const data = sortByIndex(payload.data || []);
  const vectors = data
    .map((item) => item.embedding)
    .filter((embedding): embedding is number[] => Array.isArray(embedding) && embedding.length > 0);

  if (vectors.length !== inputs.length) {
    throw new Error(`Embedding response count mismatch: expected ${inputs.length}, received ${vectors.length}.`);
  }

  return vectors;
}

export async function createQueryEmbedding(config: AppConfig, input: string): Promise<number[] | null> {
  const [embedding] = await createEmbeddings(config, [input]);
  return embedding || null;
}
