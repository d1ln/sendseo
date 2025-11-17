// src/tests/heuristic_test.ts
import { fastFetch, fetchWithFallback } from "../fetch";
import * as fs from "fs";
import * as path from "path";
import * as cheerio from "cheerio";

type ReportRow = {
  url: string;
  needBrowser?: boolean;
  usedFallback?: boolean;
  title?: string;
  error?: string;
};

function analyzeForBrowserNeed(html: string | null | undefined): boolean {
  if (!html) return true;
  const txt = String(html).toLowerCase();
  // heuristics: client-heavy frameworks, presence of __next_data__, long scripts, or many JS-only markers
  if (
    txt.includes("__next_data__") ||
    txt.includes("window.__INITIAL_STATE__") ||
    txt.includes('id="__nuxt"')
  )
    return true;
  // lots of script tags or minimal body -> likely client-rendered
  const scriptCount = (html.match(/<script\b/gi) || []).length;
  const bodyLen = html.replace(/<[^>]+>/g, "").trim().length;
  if (scriptCount > 8 || bodyLen < 200) return true;
  return false;
}

function extractTitleFromHtml(
  raw: string | null | undefined,
): string | undefined {
  if (!raw) return undefined;
  try {
    const $ = cheerio.load(raw);
    const t =
      $('meta[property="og:title"]').attr("content") ||
      $("title").first().text() ||
      $("h1").first().text();
    return t ? String(t).trim() : undefined;
  } catch {
    return undefined;
  }
}

async function run() {
  const sampleFile = path.join(process.cwd(), "sample_urls.json");
  if (!fs.existsSync(sampleFile)) {
    console.error("Missing sample_urls.json in project root");
    process.exit(1);
  }

  const urls: string[] = JSON.parse(fs.readFileSync(sampleFile, "utf8"));
  const results: ReportRow[] = [];

  for (const url of urls) {
    console.log("Testing", url);
    const row: ReportRow = { url };
    try {
      // try fastFetch first (fast HTTP GET)
      let html: string | null = null;
      try {
        const h = await fastFetch(url).catch(() => null);
        html =
          typeof h === "string"
            ? h
            : h && (h as any).html
              ? (h as any).html
              : h
                ? String(h)
                : null;
      } catch (e) {
        html = null;
      }

      const needBrowser = analyzeForBrowserNeed(html);
      row.needBrowser = needBrowser;

      if (!html || needBrowser) {
        // use fetchWithFallback (may run Playwright)
        const res = await fetchWithFallback(url);
        if (!res) {
          row.usedFallback = true;
          row.error = "fetchWithFallback returned empty";
          results.push(row);
          continue;
        }
        // support both shapes: string or { html }
        html =
          typeof res === "string"
            ? res
            : (res as any).html || (res as any).data || null;
        row.usedFallback = true;
      }

      row.title = extractTitleFromHtml(html);
      results.push(row);
    } catch (err: any) {
      row.error = err && err.message ? err.message : String(err);
      results.push(row);
    }
  }

  fs.writeFileSync("heuristic_report.json", JSON.stringify(results, null, 2));
  console.log("Report written to heuristic_report.json");
}

run().catch((err) => {
  console.error("Fatal", err);
  process.exit(1);
});
