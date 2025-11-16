// src/outline.ts
import getLLMClient from './llm';

/**
 * Normalize a single outline item into canonical shape:
 * { h2: string, suggested_word_count?: number, target_keyword?: string }
 */
function normalizeItem(it: any, idx = 0, fallbackKw?: string) {
  if (!it) return { h2: `Section ${idx + 1}`, suggested_word_count: 150, target_keyword: fallbackKw || '' };
  if (typeof it === 'string') return { h2: it.trim(), suggested_word_count: 150, target_keyword: fallbackKw || '' };
  if (typeof it === 'object') {
    const h2 = (it.h2 || it.heading || it.title || it.name || it.headline || '').toString().trim();
    const suggested_word_count = it.suggested_word_count || it.expected_words || it.words || 150;
    const target_keyword = it.target_keyword || it.keyword || fallbackKw || '';
    const notes = it.notes || it.note || undefined;
    return { h2: h2 || `Section ${idx + 1}`, suggested_word_count, target_keyword, ...(notes ? { notes } : {}) };
  }
  return { h2: String(it).slice(0, 120), suggested_word_count: 150, target_keyword: fallbackKw || '' };
}

function normalizeOutlineResp(resp: any, fallbackKw?: string) {
  if (!resp) return { outline: [] };
  if (Array.isArray(resp)) return { outline: resp.map((it, i) => normalizeItem(it, i, fallbackKw)) };
  const arrCandidates = resp.outline || resp.sections || resp.items || resp.content || resp.children;
  if (Array.isArray(arrCandidates)) {
    return { outline: arrCandidates.map((it: any, i: number) => normalizeItem(it, i, fallbackKw)), notes: resp.notes || resp.note || resp.summary };
  }
  const maybeSingle = resp.h2 || resp.heading || resp.title || resp.name;
  if (maybeSingle) return { outline: [normalizeItem(resp, 0, fallbackKw)], notes: resp.notes || resp.note };
  for (const k of Object.keys(resp)) {
    if (Array.isArray(resp[k])) {
      return { outline: resp[k].map((it: any, i: number) => normalizeItem(it, i, fallbackKw)), notes: resp.notes || resp.note };
    }
  }
  return { outline: [{ h2: String(resp).slice(0, 120), suggested_word_count: 150, target_keyword: fallbackKw || '' }], notes: 'normalized fallback' };
}

export async function generateOutline(brief: any) {
  const client = getLLMClient();
  const fallbackKw = (brief && brief.recommended_keywords && brief.recommended_keywords[0]) || '';
  if (client && typeof client.generateOutline === 'function') {
    try {
      const resp = await client.generateOutline(brief);
      return normalizeOutlineResp(resp, fallbackKw);
    } catch (e) {
      console.warn('LLM generateOutline failed - falling back to deterministic outline. Error:', (e as Error)?.message || e);
    }
  }
  // deterministic fallback
  const base = (brief && brief.outline && Array.isArray(brief.outline)) ? brief.outline : (brief && brief.headings ? brief.headings : []);
  const outline = Array.isArray(base) && base.length
    ? base.map((s: any, i: number) => (typeof s === 'string' ? { h2: s, suggested_word_count: 150, target_keyword: fallbackKw } : normalizeItem(s, i, fallbackKw)))
    : [
        { h2: brief?.title || 'Intro', suggested_word_count: 120, target_keyword: fallbackKw },
        { h2: 'Main', suggested_word_count: 300, target_keyword: fallbackKw },
        { h2: 'Conclusion', suggested_word_count: 120, target_keyword: fallbackKw }
      ];
  return { outline, notes: 'stub: no LLM key present' };
}
