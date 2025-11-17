// src/index.ts
import { fetchWithFallback } from "./fetch";
import { extractStructure, buildSemanticBrief } from "./extract";
import { generateOutline } from "./outline";
import { assembleDraft } from "./generate";
import { paragraphSimilarity, passesSimilarityThreshold } from "./safety";

async function run(url: string) {
  console.log("Fetching:", url);
  const fetched = await fetchWithFallback(url);

  // support both shapes returned by fetchWithFallback (string or { html })
  const htmlSource =
    typeof fetched === "string"
      ? fetched
      : fetched && (fetched as any).html
        ? (fetched as any).html
        : "";
  if (!htmlSource) {
    console.error("fetchWithFallback returned empty HTML for", url);
    return;
  }

  // pass page URL to extractor so it can resolve relative images/links
  const extracted = extractStructure(htmlSource, url);
  console.log("Extracted title:", extracted.title || "(none)");

  const brief = buildSemanticBrief(extracted);
  console.log("Brief title:", brief.title || "(none)");

  // outlineResp may be { outline: [...] } or an array
  const outlineResp = await generateOutline(brief);
  const iterableOutline = Array.isArray(outlineResp)
    ? outlineResp
    : Array.isArray((outlineResp as any).outline)
      ? (outlineResp as any).outline
      : [];

  if (!iterableOutline || iterableOutline.length === 0) {
    console.warn(
      "generateOutline returned empty; creating fallback outline from brief.",
    );
  }
  console.log(
    "Normalized outline (sample):",
    iterableOutline.slice(0, 5).map((s: any, i: number) => {
      if (typeof s === "string") return s;
      return s.h2 || s.title || s.heading || String(s).slice(0, 60);
    }),
  );

  // assembleDraft expects an array of section-like objects
  const draft = await assembleDraft(iterableOutline, brief);
  console.log(
    "Draft title:",
    (draft && (draft.title || brief.title)) || "Untitled",
  );

  // Body HTML is expected at draft.body_html (string) or draft.html
  // Use type assertion to allow possible html/body fields on draft
  const bodyHtml =
    typeof draft === "string"
      ? draft
      : draft &&
          ((draft as any).body_html ||
            (draft as any).html ||
            (draft as any).body)
        ? (draft as any).body_html || (draft as any).html || (draft as any).body
        : "";
  if (!bodyHtml) {
    console.warn(
      "assembleDraft produced no body_html; raw draft object keys:",
      draft ? Object.keys(draft) : "none",
    );
  } else {
    // simple diagnostic: show the word count
    const wordCount = bodyHtml
      .replace(/<[^>]+>/g, " ")
      .split(/\s+/)
      .filter(Boolean).length;
    console.log(`Generated body word count: ${wordCount}`);
  }

  // Safety: paragraph-level similarity checks
  try {
    const generatedParagraphs = (bodyHtml || "")
      .split(/<\/p>|<\/h2>|<\/h1>/i)
      .map((s: string) => s.replace(/<[^>]+>/g, "").trim())
      .filter(Boolean);
    const sourceParagraphs = (extracted.paragraphs || [])
      .map((p: any) => String(p).trim())
      .filter(Boolean);

    let maxSim = 0;
    for (const gp of generatedParagraphs) {
      for (const sp of sourceParagraphs) {
        const sim = paragraphSimilarity(gp, sp);
        if (sim > maxSim) maxSim = sim;
        if (!passesSimilarityThreshold(sim)) {
          // if passesSimilarityThreshold returns false we consider it flagged
          console.warn(
            "Similarity flag — potential overlap; score:",
            sim.toFixed(3),
          );
        }
      }
    }
    console.log("Max paragraph similarity score:", maxSim);
  } catch (e: any) {
    console.warn("Safety check failed:", (e && e.message) || e);
  }

  console.log(
    "Draft assembled successfully. You can inspect draft.body_html or wire to the server UI.",
  );
  return { brief, draft, extracted };
}

const argv = process.argv.slice(2);
if (!argv[0]) {
  console.error("Usage: npm run start -- <COMPETITOR_URL>");
  process.exit(1);
}

run(argv[0])
  .then((res) => {
    // optionally pretty-print a short summary
    if (res && res.draft) {
      console.log("Result summary:");
      console.log("  Title:", res.draft.title || res.brief.title);
      const sample = (res.draft.body_html || (res.draft as any)?.html || "")
        .slice(0, 300)
        .replace(/\n+/g, " ");
      console.log("  Body sample:", sample ? sample + "…" : "(empty)");
    }
    process.exit(0);
  })
  .catch((err) => {
    console.error("Fatal:", err && err.message ? err.message : err);
    process.exit(2);
  });
