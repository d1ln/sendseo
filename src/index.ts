// src/index.ts
import { fetchWithFallback } from './fetch';
import { extractStructure, buildSemanticBrief } from './extract';
import { generateOutline } from './outline';
import { assembleDraft } from './generate';
import { paragraphSimilarity, passesSimilarityThreshold } from './safety';

async function run(url: string) {
  console.log('Fetching:', url);
  const fetched = await fetchWithFallback(url);
  console.log('Fetched source:', fetched.source);
  const extracted = extractStructure(fetched.html);
  console.log('Extracted title:', extracted.title);
  const brief = buildSemanticBrief(extracted);
  const outlineResp = await generateOutline(brief);
  console.log('Outline:', outlineResp.outline);
  const draft = await assembleDraft(outlineResp.outline, brief);
  console.log('Draft title:', draft.title);
  // safety check (stub)
  for (const secHtml of draft.body_html.split('\n')) {
    const sim = paragraphSimilarity(secHtml, extracted.paragraphs.join('\n'));
    if (!passesSimilarityThreshold(sim)) {
      console.warn('Similarity threshold failed for a section');
    }
  }
  console.log('Draft assembled (stub).');
}

const argv = process.argv.slice(2);
if (!argv[0]) {
  console.error('Usage: npm run start -- <COMPETITOR_URL>');
  process.exit(1);
}
run(argv[0]).catch(err => console.error(err));
