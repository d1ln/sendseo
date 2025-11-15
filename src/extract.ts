// src/extract.ts
import * as cheerio from 'cheerio';

export interface Extracted {
  title: string;
  meta: string;
  headings: string[];
  paragraphs: string[];
  url?: string;
}

export function extractStructure(html: string): Extracted {
  const $ = cheerio.load(html || '');
  const title = $('head > title').text() || $('h1').first().text() || '';
  const meta = $('meta[name=description]').attr('content') || $('meta[property="og:description"]').attr('content') || '';
  const headings = $('h1,h2,h3').map((i, el) => $(el).text()).get();
  const paragraphs = $('article p, .entry-content p, p').map((i, el) => $(el).text().trim()).get().filter(Boolean).slice(0,200);
  return { title, meta, headings, paragraphs };
}

export function buildSemanticBrief(e: Extracted) {
  const outline = e.headings.slice(0,4).map(h => ({ heading: h || 'Section', expected_words: 150 }));
  const gaps = ['Add practical examples', 'Include a short checklist'];
  return {
    title: e.title || 'Untitled',
    meta: e.meta || '',
    outline,
    gaps,
    recommended_keywords: [ 'example keyword' ],
  };
}
