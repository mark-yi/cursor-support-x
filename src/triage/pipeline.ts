import type { AppConfig } from "../config.ts";
import type { KnowledgeIndex, SupportMention, SupportPayload } from "../types.ts";
import { createQueryEmbedding } from "../kb/embeddings.ts";
import { hasSemanticCoverage, searchKnowledgeIndex } from "../kb/indexer.ts";
import { rewriteQueryForRetrieval } from "../kb/query-rewrite.ts";
import { rerankRetrievedSources } from "../kb/rerank.ts";
import { buildHeuristicDraft } from "./heuristic.ts";
import { generateDraftWithOpenAI } from "./openai.ts";
import { buildSlackFields, buildSlackMessage } from "./slack.ts";

const RETRIEVAL_CANDIDATE_COUNT = 5;
const FINAL_SOURCE_COUNT = 3;

export async function buildSupportPayload(
  config: AppConfig,
  index: KnowledgeIndex,
  mention: SupportMention
): Promise<SupportPayload> {
  const startedAt = Date.now();

  const retrievalStartedAt = Date.now();
  const rewrittenQuery = await rewriteQueryForRetrieval(config, mention.text);
  const lexicalQuery = rewrittenQuery !== mention.text ? `${mention.text}\n${rewrittenQuery}` : mention.text;
  let queryEmbedding: number[] | null = null;
  if (config.openAIKey && hasSemanticCoverage(index)) {
    try {
      queryEmbedding = await createQueryEmbedding(config, rewrittenQuery);
    } catch (error) {
      console.warn(`Query embedding warning: ${(error as Error).message}`);
    }
  }
  const retrievalCandidates = searchKnowledgeIndex(index, lexicalQuery, RETRIEVAL_CANDIDATE_COUNT, {
    queryEmbedding,
    semanticWeight: config.retrievalSemanticWeight
  });
  let rerankedCandidates = retrievalCandidates;
  const rerankAttempted = Boolean(config.openAIKey && retrievalCandidates.length > 1);
  if (retrievalCandidates.length > 1) {
    try {
      rerankedCandidates = await rerankRetrievedSources(config, mention, rewrittenQuery, retrievalCandidates);
    } catch (error) {
      console.warn(`Retrieval rerank warning: ${(error as Error).message}`);
    }
  }
  const rerankChangedOrder = retrievalCandidates.some((candidate, indexValue) => {
    const rerankedCandidate = rerankedCandidates[indexValue];
    return rerankedCandidate ? rerankedCandidate.url !== candidate.url : false;
  });
  const sources = rerankedCandidates.slice(0, FINAL_SOURCE_COUNT);
  const retrievalMs = Date.now() - retrievalStartedAt;

  const heuristicDraft = buildHeuristicDraft(mention, sources);

  const modelStartedAt = Date.now();
  const modelDraft = await generateDraftWithOpenAI(config, mention, sources, heuristicDraft);
  const modelMs = Date.now() - modelStartedAt;
  const draft = modelDraft || heuristicDraft;

  const fallback = sources.length > 0 ? draft.fallback : draft.fallback || heuristicDraft.fallback;
  const slackFields = buildSlackFields({
    mention,
    suggested_response: draft.suggested_response,
    suggested_reply: draft.suggested_reply,
    sources
  });

  return {
    mention,
    triage: draft.triage,
    suggested_response: draft.suggested_response,
    suggested_reply: draft.suggested_reply,
    sources,
    retrieval_debug: {
      rewritten_query: rewrittenQuery,
      retrieval_mode: queryEmbedding ? "hybrid" : "lexical",
      semantic_weight: queryEmbedding ? config.retrievalSemanticWeight : null,
      rerank_attempted: rerankAttempted,
      rerank_changed_order: rerankChangedOrder,
      top_candidates_before_rerank: retrievalCandidates,
      top_candidates_after_rerank: rerankedCandidates
    },
    slack_fields: slackFields,
    slack_message: buildSlackMessage({
      mention,
      suggested_response: draft.suggested_response,
      suggested_reply: draft.suggested_reply,
      sources
    }),
    fallback,
    sop_tags: Array.from(new Set(draft.sop_tags)),
    timing: {
      processed_at: new Date().toISOString(),
      retrieval_ms: retrievalMs,
      model_ms: modelMs,
      total_ms: Date.now() - startedAt
    },
    model: modelDraft
      ? {
          provider: "openai",
          model: config.openAIModel,
          mode: "openai-responses"
        }
      : {
          provider: "local",
          model: "heuristic-fallback",
          mode: "heuristic"
        }
  };
}
