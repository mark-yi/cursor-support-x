export type SourceType = "docs" | "pricing" | "policy" | "faq";

export type TriageCategory =
  | "billing/pricing"
  | "account/access"
  | "product usage/how-to"
  | "bugs/incidents"
  | "docs gap/unclear policy"
  | "escalation required";

export type TriagePriority = "low" | "medium" | "high" | "critical";

export interface SupportMention {
  id: string;
  text: string;
  authorId: string;
  authorHandle: string;
  createdAt: string;
  permalink: string;
  conversationId: string | null;
  inReplyToUserId: string | null;
}

export interface MentionState {
  lastSeenMentionId: string | null;
  processedMentionIds: string[];
  updatedAt: string | null;
}

export interface KnowledgeDocument {
  id: string;
  url: string;
  title: string;
  text: string;
  sourceType: SourceType;
  fetchedAt: string;
  checksum: string;
  links: string[];
}

export interface KnowledgeChunk {
  id: string;
  documentId: string;
  url: string;
  title: string;
  text: string;
  position: number;
  tokens: string[];
  sourceType: SourceType;
  embedding: number[] | null;
}

export interface KnowledgeIndex {
  generatedAt: string;
  seedUrls: string[];
  documents: KnowledgeDocument[];
  chunks: KnowledgeChunk[];
  embeddingModel: string | null;
  embeddingDimensions: number | null;
}

export interface RetrievedSource {
  title: string;
  url: string;
  snippet: string;
  relevanceScore: number;
  relevanceReason: string;
  sourceType: SourceType;
}

export interface SupportFallback {
  reason: string;
  likely_issue_areas: string[];
  manual_next_step: string;
}

export interface SupportTriage {
  category: TriageCategory;
  confidence: number;
  priority: TriagePriority;
  needs_human_review: boolean;
  summary: string;
}

export interface ModelMetadata {
  provider: string;
  model: string;
  mode: "openai-responses" | "heuristic";
}

export interface RetrievalDebug {
  rewritten_query: string;
  retrieval_mode: "lexical" | "hybrid";
  semantic_weight: number | null;
  rerank_attempted: boolean;
  rerank_changed_order: boolean;
  top_candidates_before_rerank: RetrievedSource[];
  top_candidates_after_rerank: RetrievedSource[];
}

export interface SupportPayload {
  mention: SupportMention;
  triage: SupportTriage;
  suggested_response: string;
  suggested_reply: string;
  sources: RetrievedSource[];
  retrieval_debug: RetrievalDebug;
  slack_fields: {
    new_mention: string;
    suggested_response: string;
    suggested_reply: string;
    link_to_post: string;
    sources: string;
  };
  slack_message: string;
  fallback: SupportFallback | null;
  sop_tags: string[];
  timing: {
    processed_at: string;
    retrieval_ms: number;
    model_ms: number;
    total_ms: number;
  };
  model: ModelMetadata;
}

export interface TriageDraft {
  triage: SupportTriage;
  suggested_response: string;
  suggested_reply: string;
  fallback: SupportFallback | null;
  sop_tags: string[];
}

export interface DemoDocumentSeed {
  url: string;
  title: string;
  text: string;
  sourceType: SourceType;
}

export interface XMentionsResponse {
  data?: Array<Record<string, unknown>>;
  includes?: {
    users?: Array<Record<string, unknown>>;
  };
  meta?: Record<string, unknown>;
}
