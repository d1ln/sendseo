// src/prompt.ts
// Centralized prompt templates for outline + section generation.
// Both OpenAI and Claude clients should import and use these functions.

export const STYLEGUIDE = [
  "Voice: friendly-professional, concise, second-person where helpful.",
  "Tone: authoritative but approachable.",
  "Structure: short intro (50–80 words), H2 sections 150–300 words, clear conclusion with CTA.",
  "Do NOT: use competitor phrasing verbatim, include external links or <a> tags, produce unverifiable claims, overuse passive voice.",
].join(" ");

/**
 * Returns a single-string prompt to request a JSON outline.
 * brief will be serialized by the caller (JSON.stringify) and injected.
 */
export function outlinePrompt(briefJson: string): string {
  return [
    "You are an expert Sendmarc content strategist.",
    "",
    "STYLE GUIDE:",
    STYLEGUIDE,
    "",
    "ABSOLUTE RULES:",
    "- Return ONLY valid JSON. No surrounding commentary. No markdown. No code fences.",
    "- Do NOT include hyperlinks (no <a> tags, no URLs).",
    "- Do NOT invent statistics, quotes, or unverifiable claims.",
    "",
    "TASK:",
    "Given the semantic brief below, produce a single JSON object with this shape:",
    "",
    `{
  "outline": [
    { "h2": "Heading text", "suggested_word_count": 180 }
  ],
  "key_points": ["short bullet 1", "short bullet 2", "short bullet 3"],
  "notes": "optional short note for editor"
}`,
    "",
    "BRIEF:",
    briefJson,
  ].join("\n");
}

/**
 * Returns a single-string prompt to request HTML for one section.
 * h2 is the section heading; contextJson is a JSON-serialized brief/context.
 */
export function sectionPrompt(h2: string, contextJson: string): string {
  return [
    "You are an expert Sendmarc content writer.",
    "",
    "WRITE ONE SECTION for the H2 below. Return RAW HTML ONLY.",
    "Do NOT output markdown, code fences, or backticks. Do NOT wrap your answer in ```html.",
    "",
    "STYLE GUIDE:",
    STYLEGUIDE,
    "",
    "ABSOLUTE RULES:",
    "- Output HTML fragment only (no full page wrapper).",
    "- Do NOT include hyperlinks or <a> tags. No URLs.",
    "- Do NOT copy competitor phrasing verbatim.",
    "- Use active voice and second-person where helpful.",
    "- Keep paragraph lengths short; target 150–300 words for the section.",
    "",
    `H2: ${h2}`,
    "",
    "CONTEXT (JSON):",
    contextJson,
    "",
    "Now produce the HTML for this section (start with <h2> if appropriate).",
  ].join("\n");
}
