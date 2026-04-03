import type { AppConfig } from "../config.ts";
import type { RetrievedSource, SupportMention } from "../types.ts";

interface OpenAIResponsePayload {
  output_text?: string;
  output?: Array<{
    content?: Array<{
      text?: string;
      type?: string;
    }>;
  }>;
}

function extractOutputText(payload: OpenAIResponsePayload): string | null {
  if (typeof payload.output_text === "string" && payload.output_text.trim()) {
    return payload.output_text.trim();
  }

  for (const item of payload.output || []) {
    for (const content of item.content || []) {
      if (content.type?.includes("text") && content.text?.trim()) {
        return content.text.trim();
      }
    }
  }

  return null;
}

function sanitizeOrderedIndexes(value: unknown, candidateCount: number): number[] | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const orderedIndexes = (value as Record<string, unknown>).ordered_indexes;
  if (!Array.isArray(orderedIndexes)) {
    return null;
  }

  const seen = new Set<number>();
  const sanitized = orderedIndexes
    .map((item) => Number(item))
    .filter((item) => Number.isInteger(item) && item >= 0 && item < candidateCount)
    .filter((item) => {
      if (seen.has(item)) {
        return false;
      }
      seen.add(item);
      return true;
    });

  if (sanitized.length === 0) {
    return null;
  }

  for (let index = 0; index < candidateCount; index += 1) {
    if (!seen.has(index)) {
      sanitized.push(index);
    }
  }

  return sanitized;
}

export async function rerankRetrievedSources(
  config: AppConfig,
  mention: SupportMention,
  rewrittenQuery: string,
  candidates: RetrievedSource[]
): Promise<RetrievedSource[]> {
  if (!config.openAIKey || candidates.length <= 1) {
    return candidates;
  }

  const response = await fetch(config.openAIBaseUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.openAIKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: config.openAIModel,
      reasoning: {
        effort: "low"
      },
      input: [
        {
          role: "system",
          content: [
            {
              type: "input_text",
              text:
                "You rerank retrieved help-doc candidates for a human support workflow. Choose which candidate docs best answer the user's issue. Prefer exact policy or troubleshooting guidance over tangentially related pages. Use only the provided candidates. Return only JSON."
            }
          ]
        },
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: JSON.stringify(
                {
                  mention: mention.text,
                  rewritten_query: rewrittenQuery,
                  candidates: candidates.map((candidate, index) => ({
                    index,
                    title: candidate.title,
                    url: candidate.url,
                    snippet: candidate.snippet,
                    relevance_reason: candidate.relevanceReason,
                    source_type: candidate.sourceType
                  })),
                  instructions: [
                    "Return candidate indexes ordered from most relevant to least relevant.",
                    "Favor pages that directly explain the user's issue or next step.",
                    "Do not invent new sources or URLs."
                  ]
                },
                null,
                2
              )
            }
          ]
        }
      ],
      text: {
        format: {
          type: "json_schema",
          name: "retrieval_rerank",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              ordered_indexes: {
                type: "array",
                items: {
                  type: "integer",
                  minimum: 0,
                  maximum: Math.max(0, candidates.length - 1)
                }
              }
            },
            required: ["ordered_indexes"]
          }
        }
      },
      max_output_tokens: 120,
      store: false
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.warn(`Retrieval rerank warning: ${response.status} ${response.statusText}${errorText ? ` - ${errorText}` : ""}`);
    return candidates;
  }

  const payload = (await response.json()) as OpenAIResponsePayload;
  const outputText = extractOutputText(payload);
  if (!outputText) {
    return candidates;
  }

  try {
    const orderedIndexes = sanitizeOrderedIndexes(JSON.parse(outputText), candidates.length);
    if (!orderedIndexes) {
      return candidates;
    }
    return orderedIndexes.map((index) => candidates[index]);
  } catch (error) {
    console.warn(`Retrieval rerank parse warning: ${(error as Error).message}`);
    return candidates;
  }
}
