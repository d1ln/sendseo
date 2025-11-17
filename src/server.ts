// src/server.ts
import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import dotenv from "dotenv";
import path from "path";
import { STYLEGUIDE } from "./prompt"; // <- inject style guide into briefs

// load .env if present
dotenv.config();

/* ----------------------- Environment / Mode detection ---------------------- */
const envMock = process.env.MOCK_MODE;
export const MOCK_MODE: boolean =
  typeof envMock !== "undefined"
    ? envMock === "true" || envMock === "1"
    : !process.env.OPENAI_API_KEY && !process.env.CLAUDE_API_KEY;

const PLAYWRIGHT_ENABLED = process.env.PLAYWRIGHT_ENABLED === "true";

/* --------------------------- Helper functions ----------------------------- */
function escapeHtml(s: string) {
  const map: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  };
  return String(s).replace(/[&<>"']/g, (m) => map[m] || "");
}

/**
 * Normalize generator output into a safe HTML string.
 * Accepts: strings, arrays (of strings/objects), objects with common fields.
 */
function normalizeDraftToHtml(draft: any): string {
  if (!draft) return "<p>(no content)</p>";

  // If draft is already a string -> use it (strip fences)
  if (typeof draft === "string")
    return draft
      .replace(/```(?:html|json)?/gi, "")
      .replace(/```/g, "")
      .trim();

  // If draft has a body_html / bodyHtml / html string field -> prefer that
  const candidateStrings = [
    draft.body_html,
    draft.bodyHtml,
    draft.html,
    draft.body,
    draft.content,
  ];
  for (const c of candidateStrings) {
    if (typeof c === "string" && c.trim().length > 0)
      return (c as string)
        .replace(/```(?:html|json)?/gi, "")
        .replace(/```/g, "")
        .trim();
  }

  // If draft.sections or similar exists (array)
  const sections =
    draft.sections || draft.sections_html || draft.blocks || null;
  if (Array.isArray(sections) && sections.length) {
    return sections
      .map((s: any) => {
        if (!s) return "";
        if (typeof s === "string") return `<p>${escapeHtml(s)}</p>`;
        const heading = s.heading || s.title || s.h || "";
        const body =
          (typeof s.html === "string" && s.html) ||
          (typeof s.body === "string" && s.body) ||
          s.text ||
          "";
        const bodyStr =
          typeof body === "string" ? body : escapeHtml(JSON.stringify(body));
        return (
          (heading ? `<h2>${escapeHtml(heading)}</h2>` : "") +
          `<div>${bodyStr}</div>`
        );
      })
      .join("");
  }

  // If draft.outline exists and is an array
  if (Array.isArray(draft.outline) && draft.outline.length) {
    return draft.outline
      .map((it: any) => {
        if (typeof it === "string") return `<h2>${escapeHtml(it)}</h2>`;
        if (typeof it === "object") {
          const t = it.title || it.heading || "";
          const s =
            (typeof it.html === "string" && it.html) ||
            it.summary ||
            it.snippet ||
            it.text ||
            "";
          const sStr =
            typeof s === "string" ? s : escapeHtml(JSON.stringify(s));
          return (t ? `<h2>${escapeHtml(t)}</h2>` : "") + `<div>${sStr}</div>`;
        }
        return `<p>${escapeHtml(String(it))}</p>`;
      })
      .join("");
  }

  // If draft is an array (array of strings/objects)
  if (Array.isArray(draft)) {
    return draft
      .map((item) => {
        if (typeof item === "string") return `<p>${escapeHtml(item)}</p>`;
        if (typeof item === "object") {
          const t = item.title || item.heading || "";
          const b = item.html || item.body || item.text || "";
          const bStr =
            typeof b === "string" ? b : escapeHtml(JSON.stringify(b));
          return (t ? `<h2>${escapeHtml(t)}</h2>` : "") + `<div>${bStr}</div>`;
        }
        return `<p>${escapeHtml(String(item))}</p>`;
      })
      .join("");
  }

  // If draft is an object: try title + summary
  if (typeof draft === "object") {
    const title = draft.title || draft.headline || "";
    const summary =
      draft.summary || draft.snippet || draft.text || draft.description || "";
    if (title || summary) {
      return (
        (title ? `<h2>${escapeHtml(title)}</h2>` : "") +
        `<p>${escapeHtml(typeof summary === "string" ? summary : JSON.stringify(summary))}</p>`
      );
    }
    return `<pre>${escapeHtml(JSON.stringify(draft, null, 2))}</pre>`;
  }

  // Fallback
  return `<p>${escapeHtml(String(draft))}</p>`;
}

/* -------------------------- Pipeline module imports -----------------------
   Robust loader helper: prefer named exports, then default, then fallbacks.
------------------------------------------------------------------------- */

type AnyFn = (...args: any[]) => any;

function pickExport(mod: any, names: string[]): any {
  if (!mod) return null;
  // if module is a function itself (module.exports = fn)
  if (typeof mod === "function") return mod;
  for (const n of names) {
    if (mod[n]) return mod[n];
    if (mod.default && mod.default[n]) return mod.default[n];
  }
  // last attempt: default export is a function
  if (mod.default && typeof mod.default === "function") return mod.default;
  return null;
}

let fetchWithFallback:
  | ((url: string) => Promise<{ html: string } | string>)
  | null = null;
let extractStructure: ((html: string) => any) | null = null;
let buildSemanticBrief: ((extracted: any) => any) | null = null;
let generateOutline: ((brief: any) => Promise<any>) | null = null;
let assembleDraft: ((outline: any, brief: any) => Promise<any>) | null = null;
let paragraphSimilarity: ((a: string, b: string) => number) | null = null;

try {
  // require modules (works for both ts-node and compiled dist)
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const fetchMod = require("./fetch");
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const extractMod = require("./extract");
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const briefMod =
    (() => {
      try {
        return require("./brief");
      } catch {
        return null;
      }
    })() || extractMod;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const outlineMod = require("./outline");
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const genMod = require("./generate");
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const safetyMod = require("./safety");

  // pick best exports
  fetchWithFallback = pickExport(fetchMod, [
    "fetchWithFallback",
    "fastFetch",
    "fetch",
  ]);
  extractStructure = pickExport(extractMod, [
    "extractStructure",
    "buildSemanticBrief",
    "extract",
  ]);
  buildSemanticBrief = pickExport(briefMod, [
    "buildSemanticBrief",
    "buildBrief",
    "brief",
  ]);
  generateOutline = pickExport(outlineMod, ["generateOutline", "outline"]);
  assembleDraft = pickExport(genMod, [
    "assembleDraft",
    "generateDraft",
    "generateSection",
    "default",
  ]);
  paragraphSimilarity = pickExport(safetyMod, [
    "paragraphSimilarity",
    "passesSimilarityThreshold",
  ]);

  console.log("MODULES LOADED:", {
    fetch: !!fetchWithFallback,
    extract: !!extractStructure,
    brief: !!buildSemanticBrief,
    outline: !!generateOutline,
    generate: !!assembleDraft,
    safety: !!paragraphSimilarity,
  });
} catch (e: any) {
  console.warn(
    "Pipeline module load encountered an error, falling back to stubs. Error:",
    (e && e.message) || e,
  );
}

// Fallback stubs if not present — keep them minimal & deterministic
if (!fetchWithFallback) {
  fetchWithFallback = async (url: string) => ({
    html: `<html><head><title>fetched</title></head><body><h1>Sample</h1><p>Sample paragraph from ${url}</p></body></html>`,
  });
}
if (!extractStructure) {
  extractStructure = (html: string) => ({
    paragraphs: html
      .replace(/<[^>]+>/g, " ")
      .split(/\s+/)
      .filter(Boolean),
    headings: [],
  });
}
if (!buildSemanticBrief) {
  buildSemanticBrief = (ex: any) => ({
    title: ex.headings?.[0] || "Demo Title",
    outline: ["Intro", "Main point", "Conclusion"],
  });
}
if (!generateOutline) {
  generateOutline = async (brief: any) => ({ outline: brief.outline || [] });
}
if (!assembleDraft) {
  assembleDraft = async (outline: any, brief: any) => ({
    title: brief.title || "Demo Title",
    body_html: Array.isArray(outline)
      ? outline
          .map(
            (s: any) =>
              `<h2>${typeof s === "string" ? s : s?.h2 || s?.title || "Section"}</h2><p>Demo content</p>`,
          )
          .join("")
      : `<p>Demo output</p>`,
  });
}
if (!paragraphSimilarity) {
  paragraphSimilarity = (_a: string, _b: string) => 0;
}

/* ------------------------------- Express app ------------------------------ */
const app = express();
app.use(cors());
app.use(bodyParser.json({ limit: "2mb" }));

// Serve static UI from /public if present (convenience)
const publicDir = path.join(__dirname, "..", "public");
app.use(express.static(publicDir));
app.get("/", (_req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});

// Health endpoint
app.get("/health", (_req, res) =>
  res.json({ ok: true, mode: MOCK_MODE ? "mock" : "live" }),
);

// Primary generate endpoint
app.post("/generate", async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: "url required" });

    // MOCK mode shortcut
    if (MOCK_MODE) {
      const mockTitle = `Demo article derived from ${url}`;
      const mockHtml = `
        <article>
          <h1>${mockTitle}</h1>
          <h2>Intro</h2><p>This is mock content for the intro. Replace with the LLM-generated version in live mode.</p>
          <h2>Main</h2><p>Mock main section for demo purposes.</p>
          <h2>Conclusion</h2><p>Mock conclusion and call-to-action.</p>
        </article>
      `;
      const metrics = {
        originality_max: 0,
        word_count: mockHtml
          .replace(/<[^>]+>/g, " ")
          .split(/\s+/)
          .filter(Boolean).length,
      };
      return res.json({ title: mockTitle, html: mockHtml, metrics });
    }

    /* ------------------------------ Live flow ------------------------------ */

    // 1. fetch (support fetchWithFallback returning string or { html })
    const fetched = await (fetchWithFallback as any)(url);
    const fetchedHtml: string =
      typeof fetched === "string"
        ? fetched
        : fetched && typeof (fetched as any).html === "string"
          ? (fetched as any).html
          : "";

    // 2. extract
    const extracted = (extractStructure as any)(fetchedHtml);
    extracted.url = url;

    // 3. brief
    const brief = (buildSemanticBrief as any)(extracted);

    // ---- INJECT STYLEGUIDE HERE if not present ----
    try {
      if (brief && !brief.styleguide) {
        // attach centralized prompt styleguide so LLMs always receive it
        (brief as any).styleguide = STYLEGUIDE;
      }
    } catch (e: any) {
      // non-fatal — continue without styleguide if something odd happened
      console.warn("Could not attach styleguide to brief:", e && e.message);
    }
    // ------------------------------------------------

    // 4. outline
    const outlineResp = await (generateOutline as any)(brief);

    // NORMALIZE outlineResp -> iterableOutline (array of section-like objects)
    let iterableOutline: any[] = [];
    if (Array.isArray(outlineResp)) {
      iterableOutline = outlineResp;
    } else if (Array.isArray(outlineResp?.outline)) {
      iterableOutline = outlineResp.outline;
    } else if (Array.isArray(outlineResp?.sections)) {
      iterableOutline = outlineResp.sections;
    } else if (outlineResp && typeof outlineResp === "object") {
      if (Array.isArray(outlineResp.items)) {
        iterableOutline = outlineResp.items;
      } else if (
        typeof outlineResp.h2 === "string" ||
        typeof outlineResp.title === "string"
      ) {
        iterableOutline = [outlineResp];
      } else if (outlineResp.content && Array.isArray(outlineResp.content)) {
        iterableOutline = outlineResp.content;
      } else {
        iterableOutline = Object.keys(outlineResp).map((k) => ({
          h2: k,
          text: outlineResp[k],
        }));
      }
    }

    // sanitize headings: collapse whitespace and trim
    function cleanHeading(raw: any): string {
      if (raw == null) return "";
      const s = typeof raw === "string" ? raw : String(raw);
      return s.replace(/\s+/g, " ").trim();
    }

    iterableOutline = iterableOutline.map((item: any) => {
      if (typeof item === "string") {
        return { h2: cleanHeading(item) };
      }
      if (typeof item === "object") {
        // prefer existing .h2, then .title, .heading
        const raw =
          item.h2 ??
          item.title ??
          item.heading ??
          item.h ??
          item.heading_text ??
          "";
        const h2 = cleanHeading(raw);
        // preserve other fields but ensure canonical h2
        return { ...item, h2 };
      }
      return { h2: cleanHeading(item) };
    });

    if (!Array.isArray(iterableOutline) || iterableOutline.length === 0) {
      iterableOutline = [
        { h2: brief.title || brief.heading || "Article" },
        { h2: "Overview" },
        { h2: "Conclusion" },
      ];
      console.warn(
        "normalizeOutline: outlineResp was empty or unrecognized — using fallback skeleton",
      );
    } else {
      console.log(
        "normalizeOutline: produced",
        iterableOutline.length,
        "sections (sample h2):",
        iterableOutline.slice(0, 3).map((s) => s.h2),
      );
    }

    // 5. draft (pass iterableOutline so assembleDraft can iterate)
    const draft = await (assembleDraft as any)(iterableOutline, brief);

    // DEBUG: log draft keys to help tune normalization (non-sensitive)
    console.log(
      "DEBUG: draft keys ->",
      draft && typeof draft === "object" ? Object.keys(draft) : typeof draft,
    );

    // 6. Normalize draft -> html string
    const responseHtml = normalizeDraftToHtml(draft);

    // 7. Metrics (simple)
    const genText = responseHtml
      .replace(/<[^>]+>/g, " ")
      .split(/\s+/)
      .filter(Boolean);
    let maxSim = 0;
    try {
      const genParagraphs = responseHtml
        .split(/<\/p>|<\/h2>|<\/h1>/i)
        .map((s: string) => s.replace(/<[^>]+>/g, "").trim())
        .filter(Boolean);
      const compParagraphs = (extracted.paragraphs || []).map((p: string) =>
        String(p),
      );
      for (const gp of genParagraphs) {
        for (const cp of compParagraphs) {
          const sim = (paragraphSimilarity as any)(gp, cp);
          if (sim > maxSim) maxSim = sim;
        }
      }
    } catch (e) {
      maxSim = 0;
    }

    const metrics = { originality_max: maxSim, word_count: genText.length };

    return res.json({
      title: (draft && (draft.title || brief.title)) || "Untitled",
      html: responseHtml,
      metrics,
    });
  } catch (err: any) {
    console.error("generate error", err);
    return res.status(500).json({ error: String(err) });
  }
});

/* ------------------------------- Start server ---------------------------- */
const PORT = Number(process.env.PORT || 3000);
app.listen(PORT, () => {
  console.log(`
================================================================================
🚀 Server running: http://localhost:${PORT}

Mode: ${MOCK_MODE ? "MOCK (no API keys detected)" : "LIVE (using API key)"}
Playwright fallback enabled: ${PLAYWRIGHT_ENABLED ? "yes" : "no"}

Available endpoints:
  • GET  /health
  • POST /generate

Quick tests (copy/paste):
  curl http://localhost:${PORT}/health

  curl -X POST http://localhost:${PORT}/generate \\
    -H "Content-Type: application/json" \\
    -d '{"url":"https://example.com"}'

Frontend (when served from this server):
  • http://localhost:${PORT}/

Environment summary:
  OPENAI_API_KEY: ${process.env.OPENAI_API_KEY ? "set" : "not set"}
  CLAUDE_API_KEY: ${process.env.CLAUDE_API_KEY ? "set" : "not set"}
  MOCK_MODE (env): ${process.env.MOCK_MODE ?? "(auto)"}
================================================================================
`);
});
