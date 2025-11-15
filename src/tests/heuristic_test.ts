// src/tests/heuristic_test.ts
import { fastFetch, analyzeForBrowserNeed, fetchWithFallback } from '../fetch';
import * as fs from 'fs';
async function run() {
  const urls = JSON.parse(fs.readFileSync('sample_urls.json','utf8'));
  const results:any[] = [];
  for (const url of urls) {
    console.log('Testing', url);
    try {
      const html = await fastFetch(url).catch(e=>null);
      if (!html) {
        // fallback fetchWithFallback will try Playwright
        const f = await fetchWithFallback(url);
        results.push({ url, source: f.source, note: 'fallback used' });
        continue;
      }
      const needBrowser = analyzeForBrowserNeed(html);
      results.push({ url, needBrowser });
    } catch (err:any) {
      results.push({ url, error: String(err) });
    }
  }
  fs.writeFileSync('heuristic_report.json', JSON.stringify(results, null, 2));
  console.log('Report written to heuristic_report.json');
}
run().catch(err=>{ console.error(err); process.exit(1); });
