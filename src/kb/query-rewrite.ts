import type { AppConfig } from "../config.ts";
import { normalizeWhitespace, tokenize } from "../utils/text.ts";

const QUERY_TOKEN_EXPANSIONS: Record<string, string[]> = {
  paying: ["billing", "charge"],
  paid: ["billing", "charge"],
  billed: ["billing", "charge"],
  charged: ["billing", "charge"],
  charge: ["billing", "charge"],
  refund: ["billing", "refund"],
  stopped: ["cancel", "subscription"],
  stop: ["cancel", "subscription"],
  canceled: ["cancel", "subscription"],
  cancelled: ["cancel", "subscription"],
  canceling: ["cancel", "subscription"],
  cancelling: ["cancel", "subscription"],
  ended: ["cancel", "subscription"],
  end: ["cancel", "subscription"],
  downgrade: ["cancel", "subscription"],
  connect: ["connection"],
  connecting: ["connection"],
  login: ["authentication", "account"],
  signin: ["authentication", "account"],
  sign: ["login"],
  verification: ["authentication", "login"],
  verify: ["authentication", "login"],
  ide: ["editor"],
  editor: ["ide"]
};

const QUERY_PHRASE_EXPANSIONS: Array<{ phrases: string[]; tokens: string[] }> = [
  {
    phrases: ["turned it off", "turn it off", "turned off", "turn off"],
    tokens: ["cancel", "subscription"]
  },
  {
    phrases: ["still paying", "still billed", "still charged"],
    tokens: ["billing", "charge"]
  },
  {
    phrases: ["sign in", "sign into", "log in", "log into"],
    tokens: ["login", "authentication", "account"]
  },
  {
    phrases: ["verification code", "verify my email", "verify my account"],
    tokens: ["login", "authentication", "account"]
  },
  {
    phrases: ["can't connect", "cannot connect", "unable to connect", "failing to connect"],
    tokens: ["connection", "network", "troubleshooting"]
  },
  {
    phrases: ["in the ide", "in cursor", "cursor app"],
    tokens: ["editor", "ide"]
  }
];

interface OpenAIRewritePayload {
  output_text?: string;
  output?: Array<{
    content?: Array<{
      text?: string;
      type?: string;
    }>;
  }>;
}

function extractOutputText(payload: OpenAIRewritePayload): string | null {
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

export function expandSupportSearchTokens(tokens: string[], rawQuery: string): string[] {
  const expanded = [...tokens];
  const seen = new Set(tokens);
  const lowerQuery = rawQuery.toLowerCase();

  for (const token of tokens) {
    for (const extraToken of QUERY_TOKEN_EXPANSIONS[token] || []) {
      if (!seen.has(extraToken)) {
        seen.add(extraToken);
        expanded.push(extraToken);
      }
    }
  }

  for (const expansion of QUERY_PHRASE_EXPANSIONS) {
    if (expansion.phrases.some((phrase) => lowerQuery.includes(phrase))) {
      for (const extraToken of expansion.tokens) {
        if (!seen.has(extraToken)) {
          seen.add(extraToken);
          expanded.push(extraToken);
        }
      }
    }
  }

  return expanded;
}

export function rewriteQueryHeuristically(rawQuery: string): string {
  const tokens = expandSupportSearchTokens(Array.from(new Set(tokenize(rawQuery))), rawQuery).slice(0, 12);
  if (tokens.length === 0) {
    return normalizeWhitespace(rawQuery);
  }
  return tokens.join(" ");
}

function sanitizeModelRewrite(rawQuery: string, modelRewrite: string): string {
  const allowedTokens = new Set(
    expandSupportSearchTokens(Array.from(new Set(tokenize(rawQuery))), rawQuery)
  );

  const sanitized = Array.from(new Set(tokenize(modelRewrite)))
    .filter((token) => allowedTokens.has(token))
    .slice(0, 12);

  return sanitized.join(" ");
}

async function rewriteQueryWithOpenAI(config: AppConfig, rawQuery: string, heuristicRewrite: string): Promise<string | null> {
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
        effort: "low"
      },
      instructions:
        "Rewrite a messy customer-support message into a short retrieval query for a docs search engine. Keep it to 4-12 lowercase keywords. Preserve billing, account, bug, and product terms. Remove filler, tone, and greetings. Return plain text only.",
      input: JSON.stringify({
        raw_query: rawQuery,
        heuristic_rewrite: heuristicRewrite
      }),
      max_output_tokens: 40,
      store: false
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.warn(`Query rewrite warning: ${response.status} ${response.statusText}${errorText ? ` - ${errorText}` : ""}`);
    return null;
  }

  const payload = (await response.json()) as OpenAIRewritePayload;
  const rewritten = extractOutputText(payload);
  if (!rewritten) {
    return null;
  }

  const sanitizedRewrite = sanitizeModelRewrite(rawQuery, rewritten);
  return sanitizedRewrite || null;
}

export async function rewriteQueryForRetrieval(config: AppConfig, rawQuery: string): Promise<string> {
  const heuristicRewrite = rewriteQueryHeuristically(rawQuery);

  try {
    const modelRewrite = await rewriteQueryWithOpenAI(config, rawQuery, heuristicRewrite);
    return modelRewrite || heuristicRewrite;
  } catch (error) {
    console.warn(`Query rewrite warning: ${(error as Error).message}`);
    return heuristicRewrite;
  }
}
