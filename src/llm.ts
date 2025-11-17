// src/llm.ts
import fetch from "node-fetch";
import { outlinePrompt, sectionPrompt } from "./prompt";

/**
 * LLM Client interface used by the rest of the pipeline.
 */
export interface LLMClient {
  generateOutline(brief: any): Promise<any>;
  generateSection(
    h2: string,
    context: any,
  ): Promise<{ html: string; word_count: number }>;
}

/* ----------------------------- Helpers ---------------------------------- */
function safeTrim(s: any) {
  if (s == null) return "";
  if (typeof s === "string") return s.trim();
  try {
    return String(s).trim();
  } catch {
    return "";
  }
}
function tryParseJsonMaybe(s: string | null | undefined) {
  if (!s || typeof s !== "string") return null;
  const trimmed = s.trim();
  if (!trimmed) return null;
  // remove common fences if present
  const cleaned = trimmed
    .replace(/^\s*```(?:json|html)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}
function stripFences(s: string) {
  if (!s || typeof s !== "string") return "";
  return s
    .replace(/```(?:json|html)?/gi, "")
    .replace(/```/g, "")
    .trim();
}

/* ------------------ OpenAI Responses Client --------------------------- */
export class OpenAIResponsesClient implements LLMClient {
  apiKey: string;
  model: string;
  constructor(apiKey: string, model = "gpt-4o-mini") {
    if (!apiKey) throw new Error("OPENAI_API_KEY required");
    this.apiKey = apiKey;
    this.model = model;
  }

  private async callResponsesAPI(payload: any): Promise<string> {
    const res = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(payload),
      // node-fetch doesn't support timeout in options reliably older versions; keep call as-is
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`OpenAI Responses API error: ${res.status} ${text}`);
    }
    const data = await res.json().catch(() => null);
    if (!data) return "";

    // Attempt to extract useful text from likely fields
    // 1) responses API may have `output_text` or `output` or .choices
    if (typeof data.output_text === "string" && data.output_text.trim())
      return data.output_text.trim();
    if (typeof data.output === "string" && data.output.trim())
      return data.output.trim();
    if (Array.isArray(data.output)) {
      return data.output
        .map((o: any) => {
          if (typeof o === "string") return o;
          if (o?.content && typeof o.content === "string") return o.content;
          if (o?.text) return o.text;
          if (Array.isArray(o?.content))
            return o.content
              .map((c: any) => safeTrim(c?.text || c?.content || c))
              .filter(Boolean)
              .join("\n");
          return "";
        })
        .filter(Boolean)
        .join("\n")
        .trim();
    }
    if (Array.isArray(data?.choices) && data.choices.length) {
      const c = data.choices[0];
      if (c?.message?.content) {
        if (typeof c.message.content === "string")
          return c.message.content.trim();
        if (Array.isArray(c.message.content)) {
          return c.message.content
            .map((x: any) => safeTrim(x?.text || x))
            .filter(Boolean)
            .join("\n")
            .trim();
        }
      }
      if (c?.text) return String(c.text).trim();
    }
    // fallback dump
    try {
      return JSON.stringify(data);
    } catch {
      return "";
    }
  }

  async generateOutline(brief: any) {
    const prompt = outlinePrompt(JSON.stringify(brief, null, 2));
    try {
      const raw = await this.callResponsesAPI({
        model: this.model,
        input: prompt,
        max_output_tokens: 800,
      });
      const cleaned = stripFences(raw || "");
      // try direct parse
      const parsed = tryParseJsonMaybe(cleaned) || tryParseJsonMaybe(raw);
      if (parsed && parsed.outline) return parsed;
      // try to extract first JSON-like substring
      const maybeJson = (cleaned || "").match(/\{[\s\S]*\}/);
      if (maybeJson) {
        const p = tryParseJsonMaybe(maybeJson[0]);
        if (p && p.outline) return p;
      }
      // fallback deterministic outline from brief
      return {
        outline: (brief?.outline || [])
          .slice(0, 6)
          .map((s: any, i: number) => ({
            h2: s?.heading || s?.title || String(s || `Section ${i + 1}`),
            suggested_word_count: s?.expected_words || 150,
          })),
        key_points: [],
        notes: "fallback: could not parse model output",
      };
    } catch (e: any) {
      console.warn("OpenAI generateOutline error:", e && e.message);
      return {
        outline: (brief?.outline || [])
          .slice(0, 6)
          .map((s: any, i: number) => ({
            h2: s?.heading || s?.title || String(s || `Section ${i + 1}`),
            suggested_word_count: s?.expected_words || 150,
          })),
        key_points: [],
        notes: "fallback: API error",
      };
    }
  }

  async generateSection(h2: string, context: any) {
    const prompt = sectionPrompt(h2, JSON.stringify(context, null, 2));
    try {
      const raw = await this.callResponsesAPI({
        model: this.model,
        input: prompt,
        max_output_tokens: 1200,
      });
      let cleaned = stripFences(raw || "");
      // If the model returned JSON with html field, try parse
      const parsed = tryParseJsonMaybe(cleaned) || tryParseJsonMaybe(raw);
      let htmlOut = "";
      if (parsed && parsed.html) htmlOut = safeTrim(parsed.html);
      else if (/<\s*h[1-6]|<\s*p|<\s*div|<\s*pre|<\s*code/is.test(cleaned))
        htmlOut = cleaned;
      else htmlOut = `<p>${safeTrim(cleaned)}</p>`;
      if (!htmlOut) htmlOut = `<h2>${h2}</h2><p>(empty model output)</p>`;
      const word_count = htmlOut
        .replace(/<[^>]+>/g, " ")
        .split(/\s+/)
        .filter(Boolean).length;
      return { html: htmlOut, word_count };
    } catch (e: any) {
      console.warn("OpenAI generateSection failed:", e && e.message);
      const html = `<h2>${h2}</h2><p>(LLM error)</p>`;
      return { html, word_count: html.split(/\s+/).length };
    }
  }
}

/* ---------------------------- Claude Client -------------------------------- */
export class ClaudeClient implements LLMClient {
  apiKey: string;
  model: string;
  constructor(apiKey: string, model = "claude-2.1") {
    if (!apiKey) throw new Error("CLAUDE_API_KEY required");
    this.apiKey = apiKey;
    this.model = model;
  }

  private async callClaude(prompt: string) {
    const res = await fetch("https://api.anthropic.com/v1/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-Key": this.apiKey },
      body: JSON.stringify({
        model: this.model,
        prompt,
        max_tokens: 800,
        temperature: 0.2,
      }),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      throw new Error("Claude API error: " + res.status + " " + t);
    }
    const data = await res.json().catch(() => null);
    if (!data) return "";
    return data.completion ?? data.output ?? data?.text ?? JSON.stringify(data);
  }

  async generateOutline(brief: any) {
    const prompt = outlinePrompt(JSON.stringify(brief, null, 2));
    try {
      const raw = await this.callClaude(prompt);
      const cleaned = stripFences(String(raw || ""));
      const parsed =
        tryParseJsonMaybe(cleaned) || tryParseJsonMaybe(String(raw));
      if (parsed && parsed.outline) return parsed;
      const maybeJson = String(cleaned).match(/\{[\s\S]*\}/);
      if (maybeJson) {
        const p = tryParseJsonMaybe(maybeJson[0]);
        if (p && p.outline) return p;
      }
      return {
        outline: (brief?.outline || [])
          .slice(0, 6)
          .map((s: any, i: number) => ({
            h2: s?.heading || s?.title || String(s || `Section ${i + 1}`),
            suggested_word_count: s?.expected_words || 150,
          })),
        key_points: [],
        notes: "fallback",
      };
    } catch (e: any) {
      console.warn("Claude generateOutline error:", e && e.message);
      return {
        outline: (brief?.outline || [])
          .slice(0, 6)
          .map((s: any, i: number) => ({
            h2: s?.heading || s?.title || String(s || `Section ${i + 1}`),
            suggested_word_count: s?.expected_words || 150,
          })),
        key_points: [],
        notes: "fallback",
      };
    }
  }

  async generateSection(h2: string, context: any) {
    const prompt = sectionPrompt(h2, JSON.stringify(context, null, 2));
    try {
      const raw = await this.callClaude(prompt);
      const cleaned = stripFences(String(raw || ""));
      const parsed =
        tryParseJsonMaybe(cleaned) || tryParseJsonMaybe(String(raw));
      let htmlOut = "";
      if (parsed && parsed.html) htmlOut = safeTrim(parsed.html);
      else if (String(cleaned).match(/<\s*p|<\s*h|<\s*div|<pre|<code/is))
        htmlOut = String(cleaned).trim();
      else htmlOut = `<p>${safeTrim(String(cleaned))}</p>`;
      const word_count = htmlOut
        .replace(/<[^>]+>/g, " ")
        .split(/\s+/)
        .filter(Boolean).length;
      return { html: htmlOut, word_count };
    } catch (e: any) {
      console.warn("Claude generateSection failed:", e && e.message);
      const html = `<h2>${h2}</h2><p>(Claude error)</p>`;
      return { html, word_count: html.split(/\s+/).length };
    }
  }
}

/* ----------------------------- Factory ----------------------------------- */
export function getLLMClient(): LLMClient | null {
  const openaiKey = process.env.OPENAI_API_KEY;
  const claudeKey = process.env.CLAUDE_API_KEY;
  if (openaiKey) return new OpenAIResponsesClient(openaiKey);
  if (claudeKey) return new ClaudeClient(claudeKey);
  return null;
}

export default getLLMClient;
