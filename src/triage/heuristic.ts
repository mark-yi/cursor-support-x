import type {
  RetrievedSource,
  SupportFallback,
  SupportMention,
  TriageCategory,
  TriageDraft,
  TriagePriority
} from "../types.ts";
import { clamp, tokenize } from "../utils/text.ts";

const CATEGORY_KEYWORDS: Array<{ category: TriageCategory; keywords: string[] }> = [
  {
    category: "billing/pricing",
    keywords: ["billing", "billed", "charge", "charged", "refund", "invoice", "pricing", "plan", "subscription", "usage", "reset"]
  },
  {
    category: "account/access",
    keywords: ["login", "sign in", "signin", "account", "github", "email", "access", "auth", "invite", "team", "subscription"]
  },
  {
    category: "product usage/how-to",
    keywords: ["install", "setup", "how", "where", "shortcut", "command", "configure", "use", "works", "feature"]
  },
  {
    category: "bugs/incidents",
    keywords: ["bug", "issue", "broken", "crash", "crashes", "error", "failing", "fails", "not working", "down", "outage", "stuck"]
  },
  {
    category: "docs gap/unclear policy",
    keywords: ["docs", "documentation", "unclear", "policy", "faq", "missing", "outdated", "confusing"]
  }
];

const SUPPORT_EMAIL = "hi@cursor.com";
const BUG_REPRO_REQUIREMENTS = "OS, Cursor version, exact error, and repro steps";

function scoreCategories(text: string, sources: RetrievedSource[]): Map<TriageCategory, number> {
  const lower = text.toLowerCase();
  const scores = new Map<TriageCategory, number>();

  for (const { category, keywords } of CATEGORY_KEYWORDS) {
    let score = 0;
    for (const keyword of keywords) {
      if (lower.includes(keyword)) {
        score += 3;
      }
    }

    for (const source of sources) {
      const sourceText = `${source.title} ${source.url} ${source.relevanceReason}`.toLowerCase();
      for (const keyword of keywords) {
        if (sourceText.includes(keyword)) {
          score += 2;
        }
      }
    }

    scores.set(category, score);
  }

  return scores;
}

function chooseCategory(scores: Map<TriageCategory, number>, hasSources: boolean): TriageCategory {
  const sorted = Array.from(scores.entries()).sort((left, right) => right[1] - left[1]);
  const top = sorted[0];
  if (!top || top[1] === 0) {
    return hasSources ? "product usage/how-to" : "escalation required";
  }
  return top[0];
}

function determinePriority(text: string, category: TriageCategory): TriagePriority {
  const lower = text.toLowerCase();
  if (isIncidentIssue(lower) || lower.includes("charged twice") || lower.includes("double charged")) {
    return "critical";
  }
  if (isBillingReviewIssue(lower) || isRefundIssue(lower) || isBlockedAccessIssue(lower) || isTeamOrEnterpriseIssue(lower) || category === "bugs/incidents") {
    return "high";
  }
  if (category === "billing/pricing" || category === "account/access") {
    return "medium";
  }
  return "low";
}

function buildFallback(categoryScores: Map<TriageCategory, number>, category: TriageCategory, text: string): SupportFallback {
  const likelyIssueAreas = Array.from(categoryScores.entries())
    .filter(([, score]) => score > 0)
    .sort((left, right) => right[1] - left[1])
    .slice(0, 3)
    .map(([category]) => category);

  if (category === "billing/pricing" || isBillingReviewIssue(text) || isRefundIssue(text)) {
    return {
      reason: "The current corpus does not provide a strong enough citation-backed answer for this billing-specific dispute.",
      likely_issue_areas:
        likelyIssueAreas.length > 0 ? likelyIssueAreas : ["billing/pricing", "docs gap/unclear policy", "account/access"],
      manual_next_step: `Keep the public reply minimal, do not ask for charge details on X, and route the user to ${SUPPORT_EMAIL} for invoice or cancellation review.`
    };
  }

  if (category === "bugs/incidents") {
    return {
      reason: "The current corpus does not provide a strong enough troubleshooting or incident answer for this report.",
      likely_issue_areas:
        likelyIssueAreas.length > 0 ? likelyIssueAreas : ["bugs/incidents", "product usage/how-to", "docs gap/unclear policy"],
      manual_next_step: `Do not improvise troubleshooting. Ask for ${BUG_REPRO_REQUIREMENTS} and move the case to ${SUPPORT_EMAIL} for direct investigation.`
    };
  }

  if (category === "account/access") {
    return {
      reason: "The current corpus does not provide a strong enough account-specific answer for this request.",
      likely_issue_areas:
        likelyIssueAreas.length > 0 ? likelyIssueAreas : ["account/access", "billing/pricing", "product usage/how-to"],
      manual_next_step: `Use a minimal public reply. DM only if one small personal-account detail is needed; otherwise route the user to ${SUPPORT_EMAIL}.`
    };
  }

  return {
    reason: "No strong citation-backed answer was found in the current Cursor support corpus.",
    likely_issue_areas:
      likelyIssueAreas.length > 0
        ? likelyIssueAreas
        : ["account/access", "product usage/how-to", "bugs/incidents"],
    manual_next_step:
      "Move this to a human support owner, ask for exact repro steps or account context, and reply publicly only after verifying the current policy or workaround."
  };
}

function hasStrongSourceCoverage(mention: SupportMention, sources: RetrievedSource[]): boolean {
  if (sources.length === 0) {
    return false;
  }

  const salientTokens = tokenize(mention.text).filter(
    (token) => token.length >= 4 && token !== "cursor" && token !== "cursorsupport"
  );

  if (salientTokens.length === 0) {
    return sources[0].relevanceScore >= 24;
  }

  const sourceText = sources
    .map((source) => `${source.title} ${source.url} ${source.snippet}`)
    .join(" ")
    .toLowerCase();
  const matchedTokens = salientTokens.filter((token) => sourceText.includes(token));

  if (salientTokens.length <= 2) {
    return matchedTokens.length >= 1;
  }

  return matchedTokens.length / salientTokens.length >= 0.5;
}

function includesAny(text: string, needles: string[]): boolean {
  return needles.some((needle) => text.includes(needle));
}

function isRefundIssue(text: string): boolean {
  return includesAny(text, ["refund", "refunded", "chargeback"]);
}

function isBillingReviewIssue(text: string): boolean {
  const hasChargeSignal = includesAny(text, [
    "charged",
    "charge",
    "billed",
    "invoice",
    "payment method",
    "payment failed",
    "double charged",
    "double charge"
  ]);
  const hasCancellationDispute =
    includesAny(text, ["cancel", "canceled", "cancelled"]) &&
    includesAny(text, ["charge", "charged", "billed", "refund"]);

  return hasChargeSignal || hasCancellationDispute;
}

function isBlockedAccessIssue(text: string): boolean {
  return includesAny(text, [
    "can't sign in",
    "cant sign in",
    "cannot sign in",
    "can't login",
    "cant login",
    "cannot login",
    "locked out",
    "blocked",
    "verification code",
    "password reset",
    "2fa"
  ]);
}

function isTeamOrEnterpriseIssue(text: string): boolean {
  return includesAny(text, ["enterprise", "team admin", "admin access", "sso", "scim", "seat", "purchase order"]);
}

function isIncidentIssue(text: string): boolean {
  return includesAny(text, ["down", "outage", "incident", "everyone", "all users"]);
}

function isLightweightPersonalAccountIssue(text: string, topSource: RetrievedSource | undefined): boolean {
  if (includesAny(text, ["change email", "email address", "personal account", "delete account"])) {
    return true;
  }

  if (!topSource) {
    return false;
  }

  return includesAny(topSource.url.toLowerCase(), ["/change-your-email", "/delete-account"]);
}

function shouldRouteToSupportEmail(
  category: TriageCategory,
  text: string,
  fallback: SupportFallback | null
): boolean {
  if (category === "billing/pricing" && (isBillingReviewIssue(text) || isRefundIssue(text))) {
    return true;
  }

  if (category === "account/access" && (isBlockedAccessIssue(text) || isTeamOrEnterpriseIssue(text))) {
    return true;
  }

  if (category === "bugs/incidents" && (fallback !== null || includesAny(text, ["crash", "crashes", "broken", "not working", "stuck"]))) {
    return true;
  }

  return false;
}

function shouldOfferDM(
  category: TriageCategory,
  text: string,
  topSource: RetrievedSource | undefined,
  fallback: SupportFallback | null
): boolean {
  if (category !== "account/access") {
    return false;
  }

  if (shouldRouteToSupportEmail(category, text, fallback)) {
    return false;
  }

  return isLightweightPersonalAccountIssue(text, topSource);
}

function buildSuggestedResponse(
  mention: SupportMention,
  category: TriageCategory,
  topSource: RetrievedSource | undefined,
  fallback: SupportFallback | null
): string {
  const lower = mention.text.toLowerCase();
  const routeToSupportEmail = shouldRouteToSupportEmail(category, lower, fallback);
  const offerDM = shouldOfferDM(category, lower, topSource, fallback);

  if (fallback !== null) {
    if (isBillingReviewIssue(lower)) {
      return `Billing review. Keep the public reply short, do not move it to DM, and route account-specific charge verification to ${SUPPORT_EMAIL}.`;
    }

    if (isRefundIssue(lower)) {
      return `Refund policy question with weak citation coverage. Use the refund or billing docs only as context, then route the actual review to ${SUPPORT_EMAIL}.`;
    }

    if (category === "bugs/incidents") {
      return `Weak doc support for this bug report. Do not improvise troubleshooting. Ask for ${BUG_REPRO_REQUIREMENTS} and move the thread to ${SUPPORT_EMAIL}.`;
    }

    if (routeToSupportEmail) {
      return `This needs account-specific follow-up. Keep the public reply minimal and move the real investigation to ${SUPPORT_EMAIL}.`;
    }

    if (offerDM) {
      return `Share the nearest doc-backed answer publicly. If one small personal-account detail is needed, DM is fine; if it expands beyond that, move it to ${SUPPORT_EMAIL}.`;
    }

    return "Do not answer from AI alone. Route this to a human support owner, gather the missing account or repro details, and verify the current policy before replying.";
  }

  if (!topSource) {
    return "Use the linked help doc as the starting point, then verify one missing detail before replying if the situation is account-specific.";
  }

  if (category === "billing/pricing") {
    if (isBillingReviewIssue(lower)) {
      return `Billing review. Share ${topSource.title} publicly for policy context, then move invoice or cancellation verification to ${SUPPORT_EMAIL}. Do not ask for billing details on X or in DM.`;
    }
    if (isRefundIssue(lower)) {
      return `Refund request. Use ${topSource.title} for policy context, then route any account-specific refund review to ${SUPPORT_EMAIL}.`;
    }
    return `Use ${topSource.title} as the primary billing source and keep the public reply short and policy-backed.`;
  }

  if (offerDM) {
    return `Share ${topSource.title} publicly. If one small personal-account detail is needed, DM is fine; if it becomes a longer account issue, move it to ${SUPPORT_EMAIL}.`;
  }

  if (category === "bugs/incidents") {
    return `Use ${topSource.title} as the first troubleshooting reference. If the user is still blocked, ask for ${BUG_REPRO_REQUIREMENTS} via ${SUPPORT_EMAIL} instead of DM.`;
  }

  if (routeToSupportEmail) {
    return `Use ${topSource.title} as the public reference, then move account-specific follow-up to ${SUPPORT_EMAIL}.`;
  }

  return `Use ${topSource.title} as the primary source, keep the reply short, and include the official help link.`;
}

function buildSuggestedReply(
  mention: SupportMention,
  category: TriageCategory,
  topSource: RetrievedSource | undefined,
  fallback: SupportFallback | null
): string {
  const lower = mention.text.toLowerCase();
  const routeToSupportEmail = shouldRouteToSupportEmail(category, lower, fallback);
  const offerDM = shouldOfferDM(category, lower, topSource, fallback);

  if (fallback !== null) {
    if (isBillingReviewIssue(lower)) {
      return `This needs account-specific billing review. Please email ${SUPPORT_EMAIL} with the account email and charge date so the team can verify the invoice timeline directly.`;
    }

    if (isRefundIssue(lower)) {
      return `For an account-specific refund review, email ${SUPPORT_EMAIL} with the account email and charge details and the team can take a closer look.`;
    }

    if (category === "bugs/incidents") {
      return `Please email ${SUPPORT_EMAIL} with ${BUG_REPRO_REQUIREMENTS} so the team can investigate directly.`;
    }

    if (routeToSupportEmail) {
      return `This looks account-specific, so the fastest path is ${SUPPORT_EMAIL}. Send the account email and the exact details there so the team can review it directly.`;
    }

    if (offerDM) {
      return "If this is specific to your personal account, feel free to DM us with the account email and a short note and we can point you the right way.";
    }

    return `We should verify this directly before giving you a definitive answer here. Please contact ${SUPPORT_EMAIL} with the relevant account details or repro steps so the team can review it.`;
  }

  if (!topSource) {
    return `Here’s the closest official help page I found. If this doesn’t match what you’re seeing, email ${SUPPORT_EMAIL} with the exact account details or repro steps so the team can review it directly.`;
  }

  if (category === "billing/pricing") {
    if (isBillingReviewIssue(lower)) {
      return `Cancellation and billing guidance is here: ${topSource.url}. If you were charged after that should have taken effect, email ${SUPPORT_EMAIL} with the account email and charge date so the team can review the invoice directly.`;
    }
    if (isRefundIssue(lower)) {
      return `The refund policy is here: ${topSource.url}. If you need an account-specific review, email ${SUPPORT_EMAIL} with the account email and charge details.`;
    }
    return `The billing guidance is here: ${topSource.url}. If that still doesn’t match what you’re seeing on your account, email ${SUPPORT_EMAIL} and the team can review it.`;
  }

  if (offerDM) {
    return `You can use this help page: ${topSource.url}. If this is specific to your personal account, DM us with the account email and a short note.`;
  }

  if (category === "bugs/incidents") {
    return `Start with this troubleshooting guide: ${topSource.url}. If it still fails, email ${SUPPORT_EMAIL} with ${BUG_REPRO_REQUIREMENTS} so the team can investigate directly.`;
  }

  if (routeToSupportEmail) {
    return `This help page is the closest match: ${topSource.url}. Since this looks account-specific, please email ${SUPPORT_EMAIL} so the team can review it directly.`;
  }

  return `This help page should cover it: ${topSource.url}. If it still doesn’t match what you’re seeing, email ${SUPPORT_EMAIL} with the exact details and the team can take a closer look.`;
}

export function buildHeuristicDraft(mention: SupportMention, sources: RetrievedSource[]): TriageDraft {
  const categoryScores = scoreCategories(mention.text, sources);
  const category = chooseCategory(categoryScores, sources.length > 0);
  const priority = determinePriority(mention.text, category);
  const topSource = sources[0];
  const hasStrongSource = Boolean(topSource && topSource.relevanceScore >= 24 && hasStrongSourceCoverage(mention, sources.slice(0, 3)));
  const lower = mention.text.toLowerCase();
  const fallback = hasStrongSource ? null : buildFallback(categoryScores, category, lower);
  const routeToSupportEmail = shouldRouteToSupportEmail(category, lower, fallback);
  const confidence = clamp((topSource?.relevanceScore || 5) / 22, 0.25, 0.95);

  const summary = topSource
    ? `${category} inquiry. Best supporting source: ${topSource.title}.${routeToSupportEmail ? ` Route the account-specific follow-up to ${SUPPORT_EMAIL}.` : ""}`
    : `${category} inquiry with weak retrieval coverage.`;

  const suggested_response = buildSuggestedResponse(mention, category, topSource, fallback);
  const suggested_reply = buildSuggestedReply(mention, category, topSource, fallback);

  return {
    triage: {
      category,
      confidence,
      priority,
      needs_human_review: category === "bugs/incidents" || fallback !== null || routeToSupportEmail,
      summary
    },
    suggested_response,
    suggested_reply,
    fallback,
    sop_tags: Array.from(
      new Set([
        category,
        priority,
        fallback ? "escalate" : "citation-backed",
        routeToSupportEmail ? "route-hi-email" : "stay-on-x",
        shouldOfferDM(category, lower, topSource, fallback) ? "dm-okay" : "no-dm",
        "human-in-the-loop"
      ])
    )
  };
}
