// src/server.ts
import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';

import { fetchWithFallback } from './fetch';
import { extractStructure, buildSemanticBrief } from './extract';
import { generateOutline } from './outline';
import { assembleDraft } from './generate';
import { paragraphSimilarity } from './safety';

const app = express();
app.use(cors());
app.use(bodyParser.json({ limit: '2mb' }));

app.get('/health', (_req, res) => res.json({ ok: true }));

app.post('/generate', async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: 'url required' });

    // 1. fetch (fast path, no Playwright by default if you disable)
    const fetched = await fetchWithFallback(url);

    // 2. extract
    const extracted = extractStructure(fetched.html || '');
    extracted.url = url;

    // 3. brief
    const brief = buildSemanticBrief(extracted);

    // 4. outline
    const outlineResp = await generateOutline(brief);
    const outline = outlineResp.outline || outlineResp;

    // 5. draft
    const draft = await assembleDraft(outline, brief);

    // 6. simple metrics (stub)
    const genText = (draft.body_html || '').replace(/<[^>]+>/g,' ').split(/\s+/).filter(Boolean);
    const metrics = {
      originality_max: 0, // replace with real embedding-based check later
      word_count: genText.length
    };

    return res.json({
      title: draft.title || brief.title,
      html: draft.body_html || '<p>(no content)</p>',
      metrics
    });
  } catch (err:any) {
    console.error('generate error', err);
    return res.status(500).json({ error: String(err) });
  }
});

const PORT = Number(process.env.PORT || 3000);
app.listen(PORT, () => console.log(`Server listening on ${PORT}`));
