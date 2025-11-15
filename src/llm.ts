// src/llm.ts
import fetch from 'node-fetch';

export interface LLMClient {
  generateOutline(brief: any): Promise<any>;
  generateSection(h2: string, context: any): Promise<{html: string, word_count:number}>;
}

/**
 * OpenAIResponsesClient - uses the newer OpenAI Responses API (v1/responses)
 * See: https://api.openai.com/v1/responses
 */
export class OpenAIResponsesClient implements LLMClient {
  apiKey: string;
  model: string;
  constructor(apiKey: string, model = 'gpt-4o-mini') {
    if (!apiKey) throw new Error('OPENAI_API_KEY required');
    this.apiKey = apiKey;
    this.model = model;
  }

  async callResponsesAPI(input: any) {
    const res = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`
      },
      body: JSON.stringify(input)
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error('OpenAI Responses API error: ' + res.status + ' ' + text);
    }
    const data = await res.json();
    // attempt to extract text from the standard response shape
    const output = data.output ?? data.choices?.[0]?.message?.content ?? null;
    // If output is an array/object, try to join text segments
    if (Array.isArray(output)) {
      return output.map((o:any)=>o.content || o.text || '').join('\n');
    }
    if (typeof output === 'object' && output !== null) {
      return output.text || JSON.stringify(output);
    }
    return String(output || '');
  }

  async generateOutline(brief: any) {
    const input = {
      model: this.model,
      input: `You are an assistant that generates concise article outlines from a semantic brief. Output JSON.
Brief: ${JSON.stringify(brief)}
Produce a JSON object: {outline:[{h2, suggested_word_count, target_keyword}], notes: '...'} `,
      max_output_tokens: 800
    };
    const raw = await this.callResponsesAPI(input);
    try {
      return JSON.parse(raw || '{}');
    } catch (err) {
      return { outline: (brief.outline || []).map((s:any,i:number)=>({h2:s.heading||('Section '+(i+1)), suggested_word_count:s.expected_words||150, target_keyword: (brief.recommended_keywords||[])[0]||'' })), notes: 'fallback' };
    }
  }

  async generateSection(h2: string, context: any) {
    const input = {
      model: this.model,
      input: `You are a content writer that must produce HTML for a section given constraints. Output HTML only.
Write a section for H2: ${h2}. Context: ${JSON.stringify(context)}. Constraints: max 220 words; do not copy competitor verbatim; use Sendmarc tone.`,
      max_output_tokens: 800
    };
    const raw = await this.callResponsesAPI(input);
    const html = raw || `<h2>${h2}</h2><p>(LLM failed to generate content)</p>`;
    const word_count = html.split(/\s+/).length;
    return { html, word_count };
  }
}

/**
 * ClaudeClient (simple wrapper) - basic POST to Anthropic / Claude-style endpoint.
 * NOTE: Update endpoint & payload to match the Claude API you use (Anthropic or other).
 */
export class ClaudeClient implements LLMClient {
  apiKey: string;
  model: string;
  constructor(apiKey: string, model = 'claude-2.1') {
    if (!apiKey) throw new Error('CLAUDE_API_KEY required');
    this.apiKey = apiKey;
    this.model = model;
  }

  async callClaude(prompt: string) {
    // This is a minimal/placeholder implementation. Update to your Claude provider's API contract.
    const res = await fetch('https://api.anthropic.com/v1/complete', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': this.apiKey
      },
      body: JSON.stringify({
        model: this.model,
        prompt,
        max_tokens: 800,
        temperature: 0.2
      })
    });
    if (!res.ok) {
      const t = await res.text();
      throw new Error('Claude API error: ' + res.status + ' ' + t);
    }
    const data = await res.json();
    // Basic attempt to read the text field
    return data?.completion ?? data?.text ?? JSON.stringify(data);
  }

  async generateOutline(brief: any) {
    const prompt = `Brief: ${JSON.stringify(brief)}\nProduce a JSON outline object: {outline:[{h2, suggested_word_count, target_keyword}], notes:'...'} `;
    const raw = await this.callClaude(prompt);
    try {
      return JSON.parse(String(raw || '{}'));
    } catch (err) {
      return { outline: (brief.outline || []).map((s:any,i:number)=>({h2:s.heading||('Section '+(i+1)), suggested_word_count:s.expected_words||150, target_keyword: (brief.recommended_keywords||[])[0]||'' })), notes: 'fallback' };
    }
  }

  async generateSection(h2: string, context: any) {
    const prompt = `Write HTML only. H2: ${h2}. Context: ${JSON.stringify(context)}. Constraints: max 220 words; do not copy competitor verbatim; use Sendmarc tone.`;
    const raw = await this.callClaude(prompt);
    const html = raw || `<h2>${h2}</h2><p>(Claude failed to generate content)</p>`;
    return { html, word_count: html.split(/\s+/).length };
  }
}

// Factory to pick client
export function getLLMClient(): LLMClient | null {
  const openaiKey = process.env.OPENAI_API_KEY;
  const claudeKey = process.env.CLAUDE_API_KEY;
  if (openaiKey) return new OpenAIResponsesClient(openaiKey);
  if (claudeKey) return new ClaudeClient(claudeKey);
  return null;
}

export default getLLMClient;
