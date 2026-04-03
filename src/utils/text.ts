import { createHash } from "node:crypto";

const STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "already",
  "are",
  "as",
  "at",
  "am",
  "be",
  "but",
  "can",
  "check",
  "cus",
  "doc",
  "docs",
  "do",
  "don",
  "does",
  "by",
  "for",
  "from",
  "get",
  "got",
  "have",
  "has",
  "how",
  "i",
  "if",
  "in",
  "into",
  "is",
  "it",
  "its",
  "me",
  "my",
  "of",
  "official",
  "offer",
  "offers",
  "on",
  "or",
  "cursor",
  "cursorsupport",
  "our",
  "so",
  "still",
  "that",
  "the",
  "their",
  "there",
  "tho",
  "though",
  "this",
  "to",
  "up",
  "we",
  "what",
  "when",
  "where",
  "why",
  "wtf",
  "see",
  "number",
  "with",
  "you",
  "your"
]);

export function stableHash(value: string): string {
  return createHash("sha1").update(value).digest("hex");
}

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

export function normalizeWhitespace(value: string): string {
  return value
    .replace(/\u00a0/g, " ")
    .replace(/\r/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

export function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(Number.parseInt(code, 16)));
}

export function extractTitle(html: string): string | null {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!match) {
    return null;
  }

  return normalizeWhitespace(decodeHtmlEntities(match[1]));
}

export function extractCanonicalUrl(html: string, fallbackUrl: string): string {
  const match = html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i);
  return match?.[1]?.trim() || fallbackUrl;
}

export function extractLinks(html: string, baseUrl: string): string[] {
  const links = new Set<string>();
  const hrefPattern = /href=["']([^"']+)["']/gi;

  for (const match of html.matchAll(hrefPattern)) {
    const rawHref = match[1]?.trim();
    if (!rawHref || rawHref.startsWith("#") || rawHref.startsWith("mailto:") || rawHref.startsWith("javascript:")) {
      continue;
    }

    try {
      links.add(new URL(rawHref, baseUrl).toString());
    } catch {
      continue;
    }
  }

  return Array.from(links);
}

export function stripHtml(html: string): string {
  const withoutScripts = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ");

  const withParagraphBoundaries = withoutScripts
    .replace(/<(br|hr)\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|section|article|header|footer|li|ul|ol|h1|h2|h3|h4|h5|h6|table|tr)>/gi, "\n");

  const withoutTags = withParagraphBoundaries.replace(/<[^>]+>/g, " ");
  return normalizeWhitespace(decodeHtmlEntities(withoutTags));
}

export function tokenize(value: string): string[] {
  return normalizeWhitespace(value)
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .filter((token) => token.length > 1 && !STOPWORDS.has(token));
}

export function splitIntoChunks(text: string, maxChars = 1200): string[] {
  const paragraphs = normalizeWhitespace(text)
    .split(/\n{2,}/)
    .map((chunk) => chunk.trim())
    .filter(Boolean);

  const chunks: string[] = [];
  let current = "";

  const pushCurrent = (): void => {
    if (current.trim()) {
      chunks.push(current.trim());
      current = "";
    }
  };

  for (const paragraph of paragraphs) {
    if (paragraph.length > maxChars) {
      pushCurrent();
      const sentences = paragraph.split(/(?<=[.!?])\s+/);
      let sentenceChunk = "";

      for (const sentence of sentences) {
        const next = sentenceChunk ? `${sentenceChunk} ${sentence}` : sentence;
        if (next.length > maxChars) {
          if (sentenceChunk) {
            chunks.push(sentenceChunk.trim());
          }
          sentenceChunk = sentence;
        } else {
          sentenceChunk = next;
        }
      }

      if (sentenceChunk.trim()) {
        chunks.push(sentenceChunk.trim());
      }
      continue;
    }

    const next = current ? `${current}\n\n${paragraph}` : paragraph;
    if (next.length > maxChars) {
      pushCurrent();
      current = paragraph;
    } else {
      current = next;
    }
  }

  pushCurrent();
  return chunks.length > 0 ? chunks : [normalizeWhitespace(text)];
}

function stripHelpCenterChrome(title: string, text: string): string {
  let cleaned = normalizeWhitespace(text)
    .replace(/^←\s*Back\s+/i, "")
    .trim();

  if (cleaned.toLowerCase().startsWith(title.toLowerCase())) {
    cleaned = cleaned.slice(title.length).trim();
  }

  cleaned = cleaned
    .replace(/\bStatus:\s*All Systems Operational\s*\|\s*Contact Support\b[\s\S]*$/i, "")
    .replace(/\bRelated\b[\s\S]*$/i, "")
    .trim();

  return cleaned;
}

const FAQ_QUESTION_PATTERN = /\b(?:How|What|Why|Where|When|Can|Do|Does|Did|Is|Are|Will|Would|Should|Could|Which|Who|On)\b[^?]{0,180}\?/g;

export function splitSupportDocIntoChunks(title: string, text: string, maxChars = 1200): string[] {
  const cleaned = stripHelpCenterChrome(title, text);
  if (!cleaned) {
    return [];
  }

  const questionMatches = Array.from(cleaned.matchAll(FAQ_QUESTION_PATTERN))
    .map((match) => ({ index: match.index ?? -1 }))
    .filter((match) => match.index >= 0);

  if (questionMatches.length === 0) {
    return splitIntoChunks(cleaned, maxChars);
  }

  const sections: string[] = [];
  const intro = cleaned.slice(0, questionMatches[0].index).trim();
  if (intro) {
    sections.push(intro);
  }

  for (let index = 0; index < questionMatches.length; index += 1) {
    const start = questionMatches[index].index;
    const end = index + 1 < questionMatches.length ? questionMatches[index + 1].index : cleaned.length;
    const section = cleaned.slice(start, end).trim();
    if (section) {
      sections.push(section);
    }
  }

  return sections.flatMap((section) => {
    if (section.length <= maxChars) {
      return [section];
    }
    return splitIntoChunks(section, maxChars);
  });
}

export function buildSnippet(text: string, queryTokens: string[], maxLength = 220): string {
  const normalized = normalizeWhitespace(text);
  const lower = normalized.toLowerCase();

  for (const token of queryTokens) {
    const index = lower.indexOf(token.toLowerCase());
    if (index >= 0) {
      const start = Math.max(0, index - 60);
      const snippet = normalized.slice(start, start + maxLength);
      return snippet.length < normalized.length ? `${snippet.trim()}...` : snippet.trim();
    }
  }

  return normalized.length > maxLength ? `${normalized.slice(0, maxLength).trim()}...` : normalized;
}

export function countOccurrences(text: string, token: string): number {
  const pattern = new RegExp(`\\b${token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi");
  return (text.match(pattern) || []).length;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
