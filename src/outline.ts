// src/outline.ts
import getLLMClient from './llm';

export async function generateOutline(brief: any) {
  const client = getLLMClient();
  if (client) {
    return await client.generateOutline(brief);
  }
  // stubbed fallback
  const outline = brief.outline.map((s:any, i:number) => ({
    h2: s.heading || `Section ${i+1}`,
    suggested_word_count: s.expected_words || 150,
    target_keyword: brief.recommended_keywords ? brief.recommended_keywords[0] : ''
  }));
  return { outline, notes: 'stub: no LLM key present' };
}
