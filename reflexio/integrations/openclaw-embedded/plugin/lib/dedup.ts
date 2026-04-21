import type { InferFn } from "./openclaw-cli.ts";

const PREPROCESS_PROMPT = `Rewrite the following text into a single descriptive but concise sentence that captures the core facts or topics. Expand with 2-3 important synonyms or related terms to improve search matching. Remove conversational filler. Return ONLY the rewritten text.

Text: "{rawText}"`;

const CONTRADICTION_PROMPT = `EXISTING fact: "{existingContent}"
NEW fact: "{newContent}"

Does the NEW fact replace or contradict the EXISTING fact (same topic, updated information)?
Answer with ONLY a JSON object: {"decision": "supersede"} or {"decision": "keep_both"}`;

/**
 * Rewrite raw text into a clean search query optimized for vector + FTS search.
 * Falls back to raw text if openclaw infer is unavailable.
 */
export async function preprocessQuery(rawText: string, inferFn: InferFn): Promise<string> {
  console.info(`[reflexio] preprocessQuery: inputLen=${rawText.length} input="${rawText.slice(0, 100)}"`);
  const prompt = PREPROCESS_PROMPT.replace("{rawText}", rawText);
  const result = await inferFn(prompt);
  if (!result || result.trim().length === 0) {
    console.info(`[reflexio] preprocessQuery: infer returned empty, falling back to raw text`);
    return rawText;
  }
  console.info(`[reflexio] preprocessQuery: rewritten="${result.trim().slice(0, 120)}"`);
  return result.trim();
}

/**
 * Ask LLM whether newContent contradicts/replaces existingContent.
 * Returns "supersede" or "keep_both". Defaults to "keep_both" on any failure.
 */
export async function judgeContradiction(
  newContent: string,
  existingContent: string,
  inferFn: InferFn
): Promise<"supersede" | "keep_both"> {
  console.info(`[reflexio] judgeContradiction: existingLen=${existingContent.length} newLen=${newContent.length}`);
  console.info(`[reflexio] judgeContradiction: existing="${existingContent.slice(0, 100)}" new="${newContent.slice(0, 100)}"`);
  const prompt = CONTRADICTION_PROMPT
    .replace("{existingContent}", existingContent)
    .replace("{newContent}", newContent);

  const result = await inferFn(prompt);
  if (!result) {
    console.info(`[reflexio] judgeContradiction: infer returned empty, defaulting to keep_both`);
    return "keep_both";
  }

  console.info(`[reflexio] judgeContradiction: raw result="${result.slice(0, 200)}"`);
  try {
    const parsed = JSON.parse(result);
    const decision = parsed.decision === "supersede" ? "supersede" as const : "keep_both" as const;
    console.info(`[reflexio] judgeContradiction: decision="${decision}"`);
    return decision;
  } catch (err) {
    console.error(`[reflexio] judgeContradiction: JSON parse failed: ${err}, defaulting to keep_both`);
    return "keep_both";
  }
}

/**
 * Extract the `id:` value from a memory search snippet containing YAML frontmatter.
 */
export function extractId(snippet: string): string | null {
  const match = /^id:\s*(\S+)/m.exec(snippet);
  return match ? match[1] : null;
}
