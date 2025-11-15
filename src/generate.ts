// src/generate.ts
import getLLMClient from './llm';

export async function generateSection(h2: string, context: any) {
  const client = getLLMClient();
  if (client) {
    return await client.generateSection(h2, context);
  }
  // fallback stub
  const html = `<h2>${h2}</h2><p>This is a generated paragraph for ${h2}. Replace with LLM output.</p>`;
  return { html, word_count: html.split(/\s+/).length };
}

export async function assembleDraft(outline: any[], brief: any) {
  const sections = [];
  for (const s of outline) {
    const sec = await generateSection(s.h2, { brief });
    sections.push(sec.html);
  }
  const body = sections.join('\n');
  return {
    title: brief.title,
    meta: brief.meta,
    body_html: body
  };
}
