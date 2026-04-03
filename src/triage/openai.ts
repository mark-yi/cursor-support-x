import type { AppConfig } from "../config.ts";
import type { RetrievedSource, SupportMention, TriageDraft, TriagePriority } from "../types.ts";

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
    return payload.output_text;
  }

  for (const item of payload.output || []) {
    for (const content of item.content || []) {
      if (content.type?.includes("text") && content.text) {
        return content.text;
      }
    }
  }

  return null;
}

function sanitizePriority(value: string): TriagePriority {
  if (value === "critical" || value === "high" || value === "medium") {
    return value;
  }
  return "low";
}

function sanitizeDraft(value: unknown, fallbackDraft: TriageDraft): TriageDraft {
  if (!value || typeof value !== "object") {
    return fallbackDraft;
  }

  const candidate = value as Record<string, unknown>;
  const triage = typeof candidate.triage === "object" && candidate.triage ? (candidate.triage as Record<string, unknown>) : {};

  return {
    triage: {
      category: (triage.category as TriageDraft["triage"]["category"]) || fallbackDraft.triage.category,
      confidence:
        typeof triage.confidence === "number"
          ? Math.max(0.2, Math.min(0.98, triage.confidence))
          : fallbackDraft.triage.confidence,
      priority:
        typeof triage.priority === "string" ? sanitizePriority(triage.priority) : fallbackDraft.triage.priority,
      needs_human_review:
        typeof triage.needs_human_review === "boolean"
          ? triage.needs_human_review
          : fallbackDraft.triage.needs_human_review,
      summary:
        typeof triage.summary === "string" && triage.summary.trim()
          ? triage.summary.trim()
          : fallbackDraft.triage.summary
    },
    suggested_response:
      typeof candidate.suggested_response === "string" && candidate.suggested_response.trim()
        ? candidate.suggested_response.trim()
        : fallbackDraft.suggested_response,
    suggested_reply:
      typeof candidate.suggested_reply === "string" && candidate.suggested_reply.trim()
        ? candidate.suggested_reply.trim()
        : fallbackDraft.suggested_reply,
    fallback:
      candidate.fallback === null
        ? null
        : typeof candidate.fallback === "object" && candidate.fallback
          ? {
              reason: String((candidate.fallback as Record<string, unknown>).reason || fallbackDraft.fallback?.reason || ""),
              likely_issue_areas: Array.isArray((candidate.fallback as Record<string, unknown>).likely_issue_areas)
                ? ((candidate.fallback as Record<string, unknown>).likely_issue_areas as unknown[])
                    .map((item) => String(item))
                    .filter(Boolean)
                : fallbackDraft.fallback?.likely_issue_areas || [],
              manual_next_step: String(
                (candidate.fallback as Record<string, unknown>).manual_next_step ||
                  fallbackDraft.fallback?.manual_next_step ||
                  ""
              )
            }
          : fallbackDraft.fallback,
    sop_tags: Array.isArray(candidate.sop_tags)
      ? candidate.sop_tags.map((tag) => String(tag)).filter(Boolean)
      : fallbackDraft.sop_tags
  };
}

export async function generateDraftWithOpenAI(
  config: AppConfig,
  mention: SupportMention,
  sources: RetrievedSource[],
  fallbackDraft: TriageDraft
): Promise<TriageDraft | null> {
  if (!config.openAIKey) {
    return null;
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
        effort: config.openAIReasoningEffort
      },
      input: [
        {
          role: "system",
          content: [
            {
              type: "input_text",
              text:
                "You generate JSON for a human-in-the-loop support triage workflow. Use only the provided official Cursor sources. If the sources are weak, set a fallback instead of guessing. Produce two distinct texts: suggested_response for internal support operators, and suggested_reply for the user-facing copy-paste message."
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
                  mention,
                  sources,
                  fallbackDraft,
	                  instructions: {
	                    objective:
	                      "Produce a Slack-ready triage object for an X mention addressed to @cursorsupport.",
	                    rules: [
	                      "Do not invent policy, pricing, or troubleshooting details.",
	                      "If the support answer is not well supported, keep fallback non-null.",
	                      "suggested_response is internal guidance for Cursor employees and should not read like a reply sent to the user.",
	                      "suggested_response should read like short operator notes: direct, imperative, and operational.",
	                      "suggested_reply is the copy-pasteable user-facing message and should sound concise, plainspoken, and human.",
	                      "Do not start suggested_reply with filler like 'Thanks for flagging this' or 'Sorry about that' unless it is truly needed.",
	                      "Keep suggested_reply to roughly 2-4 short sentences.",
	                      "Because this is an X support account, keep simple doc-backed answers public when possible.",
	                      "Use DM only for lightweight personal-account follow-up that needs one small private detail, such as clarifying an individual account setting.",
	                      "For billing disputes, refunds, charges, account recovery or login issues, enterprise or team-admin issues, or other higher-touch cases, route the user to hi@cursor.com instead of DM.",
	                      "For bug or incident reports with weak source coverage, do not guess. Ask the user to email hi@cursor.com with OS, Cursor version, exact error, and repro steps.",
	                      "Do not ask for sensitive billing or account details in a public reply."
	                    ]
	                  }
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
          name: "support_triage",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              triage: {
                type: "object",
                additionalProperties: false,
                properties: {
                  category: {
                    type: "string",
                    enum: [
                      "billing/pricing",
                      "account/access",
                      "product usage/how-to",
                      "bugs/incidents",
                      "docs gap/unclear policy",
                      "escalation required"
                    ]
                  },
                  confidence: {
                    type: "number"
                  },
                  priority: {
                    type: "string",
                    enum: ["low", "medium", "high", "critical"]
                  },
                  needs_human_review: {
                    type: "boolean"
                  },
                  summary: {
                    type: "string"
                  }
                },
                required: ["category", "confidence", "priority", "needs_human_review", "summary"]
              },
              suggested_response: {
                type: "string"
              },
              suggested_reply: {
                type: "string"
              },
              fallback: {
                anyOf: [
                  {
                    type: "null"
                  },
                  {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      reason: {
                        type: "string"
                      },
                      likely_issue_areas: {
                        type: "array",
                        items: {
                          type: "string"
                        }
                      },
                      manual_next_step: {
                        type: "string"
                      }
                    },
                    required: ["reason", "likely_issue_areas", "manual_next_step"]
                  }
                ]
              },
              sop_tags: {
                type: "array",
                items: {
                  type: "string"
                }
              }
            },
            required: ["triage", "suggested_response", "suggested_reply", "fallback", "sop_tags"]
          }
        }
      }
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.warn(`OpenAI draft warning: ${response.status} ${response.statusText}${errorText ? ` - ${errorText}` : ""}`);
    return null;
  }

  const payload = (await response.json()) as OpenAIResponsePayload;
  const outputText = extractOutputText(payload);
  if (!outputText) {
    return null;
  }

  try {
    return sanitizeDraft(JSON.parse(outputText), fallbackDraft);
  } catch (error) {
    console.warn(`OpenAI JSON parse warning: ${(error as Error).message}`);
    return null;
  }
}
