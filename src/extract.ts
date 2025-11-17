// src/extract.ts
import * as cheerio from "cheerio";
import { URL } from "url";

export interface ImageInfo {
  src: string;
  alt?: string;
  srcset?: string;
}

export interface MetaInfo {
  description?: string;
  canonical?: string;
  published?: string;
}

export interface Heading {
  level: number;
  text: string;
}

export interface Extracted {
  url?: string;
  title: string;
  meta: MetaInfo;
  headings: Heading[];
  paragraphs: string[];
  images: ImageInfo[];
  main_html: string;
}

/**
 * Heuristic: find the best main content node
 */
function findMainNode($: cheerio.Root) {
  const mainSelectors = [
    "article",
    "#hosted_bootstrap-entry-content",
    ".post-content",
    ".entry-content",
    ".content-area .post-content",
    "#content",
    ".main-content",
  ];
  for (const sel of mainSelectors) {
    const cand = $(sel).first();
    if (cand && cand.length && cand.text().trim().length > 80) return cand;
  }

  // fallback: choose the largest block element by text length
  const blocks = $("body")
    .find("div, section, main")
    .toArray()
    .map((el) => ({ el, len: $(el).text().length }))
    .sort((a, b) => b.len - a.len);
  if (blocks.length && blocks[0].len > 80) return $(blocks[0].el);

  // final fallback: body
  return $("body");
}

/**
 * Promote lazy-loading attributes to real src/srcset, strip inline event handlers and styles.
 */
function fixLazyImages($: cheerio.Root, pageUrl?: string) {
  $("img").each((i, el) => {
    const $el = $(el);
    const dataSrc =
      $el.attr("data-src") ||
      $el.attr("data-lazy-src") ||
      $el.attr("data-original");
    const dataSrcset = $el.attr("data-srcset") || $el.attr("data-lazy-srcset");
    if (dataSrc && !$el.attr("src")) $el.attr("src", dataSrc);
    if (dataSrcset && !$el.attr("srcset")) $el.attr("srcset", dataSrcset);

    // resolve relative URLs to absolute where possible
    const src = $el.attr("src");
    if (src && pageUrl) {
      try {
        const abs = new URL(src, pageUrl).toString();
        $el.attr("src", abs);
      } catch (e) {
        /* ignore */
      }
    }

    const srcset = $el.attr("srcset");
    if (srcset && pageUrl) {
      // leave srcset as-is (it often contains absolute urls) but try to resolve if relative
      const resolved = srcset
        .split(",")
        .map((s) => {
          const parts = s.trim().split(/\s+/);
          try {
            const url = new URL(parts[0], pageUrl).toString();
            return [url, ...parts.slice(1)].join(" ");
          } catch {
            return s.trim();
          }
        })
        .join(", ");
      $el.attr("srcset", resolved);
    }

    // remove inline event handlers and styles to avoid accidental execution or noise
    const attribs = el && (el as any).attribs ? (el as any).attribs : undefined;
    if (attribs) {
      Object.keys(attribs).forEach((attr) => {
        if (/^on/i.test(attr) || attr === "style") $el.removeAttr(attr);
      });
    }
  });
}

/**
 * Sanitize by removing noisy selectors (nav, scripts, widgets, breadcrumbs, sidebars)
 */
function sanitizeDom($: cheerio.Root) {
  const removeSelectors = [
    "script",
    "style",
    "noscript",
    "iframe",
    "nav",
    "footer",
    "form",
    ".breadcrumb",
    ".breadcrumbs",
    ".widget",
    ".sidebar",
    ".ads",
    ".advert",
    ".related-posts",
    ".post-share",
    ".share-buttons",
    ".comments",
    ".comment",
    ".author-box",
  ];
  removeSelectors.forEach((sel) => $(sel).remove());
}

/**
 * Extract structure from an HTML string.
 * - html: raw HTML
 * - pageUrl: optional base URL to resolve relative image URLs
 */
export function extractStructure(html: string, pageUrl?: string): Extracted {
  const $ = cheerio.load(html || "", { decodeEntities: true });

  sanitizeDom($);
  fixLazyImages($, pageUrl);

  const main = findMainNode($);

  // Title: prefer meta/og, then <title>, then H1 inside main
  const title =
    ($('meta[property="og:title"]').attr("content") || "").trim() ||
    ($("title").first().text() || "").trim() ||
    (main.find("h1").first().text() || "").trim();

  // Meta description and canonical/published
  const metaDesc =
    ($('meta[name="description"]').attr("content") || "").trim() ||
    ($('meta[property="og:description"]').attr("content") || "").trim();

  const canonical = ($('link[rel="canonical"]').attr("href") || "").trim();
  const published =
    (main.find("time[datetime]").attr("datetime") || "").trim() ||
    (
      $('meta[property="article:published_time"]').attr("content") || ""
    ).trim() ||
    (main.find(".post-date").first().text() || "").trim();

  // headings h1-h3 with levels
  const headings: Heading[] = [];
  main.find("h1,h2,h3").each((i, el) => {
    const tag = ((el as any).tagName || (el as any).name || "").toString();
    const lvl = Number(tag.replace(/^h/i, "").trim()) || 2;
    const text = $(el).text().replace(/\s+/g, " ").trim();
    if (text) headings.push({ level: lvl, text });
  });

  // paragraphs: filter very short or noisy ones, limit to a reasonable count
  const paragraphs: string[] = [];
  main.find("p").each((i, el) => {
    const txt = $(el).text().replace(/\s+/g, " ").trim();
    if (txt.length > 20) paragraphs.push(txt);
  });
  // also include important list items if paragraphs are sparse
  if (paragraphs.length < 3) {
    main.find("li").each((i, el) => {
      const txt = $(el).text().replace(/\s+/g, " ").trim();
      if (txt.length > 20) paragraphs.push(txt);
    });
  }
  // cap paragraphs to avoid huge payloads
  const paragraphsCap = paragraphs.slice(0, 300);

  // images: gather src, alt, srcset (already resolved)
  const images: ImageInfo[] = [];
  main.find("img").each((i, el) => {
    const src = $(el).attr("src") || "";
    if (!src) return;
    const alt = $(el).attr("alt") || "";
    const srcset = $(el).attr("srcset") || "";
    images.push({ src, alt, srcset });
  });

  const main_html = main.html() || "";

  const extracted: Extracted = {
    url: pageUrl,
    title: title || "",
    meta: {
      description: metaDesc || undefined,
      canonical: canonical || undefined,
      published: published || undefined,
    },
    headings,
    paragraphs: paragraphsCap,
    images,
    main_html,
  };

  return extracted;
}

/**
 * Build a deterministic semantic brief for the generator from extracted structure.
 * This avoids feeding competitor paragraphs verbatim to the LLM.
 */
export function buildSemanticBrief(e: Extracted) {
  const outline = e.headings.slice(0, 4).map((h) => ({
    heading: h || "Section",
    expected_words: 180,
  }));

  const styleguide = `
# Sendmarc Style Guide

Voice: friendly-professional, concise, second-person where helpful.
Tone: authoritative but approachable.
Structure:
- Short intro (50–80 words)
- H2 sections: 150–300 words
- Clear conclusion with optional CTA.

Rules:
- Do NOT use competitor wording verbatim.
- Do NOT include competitor backlinks or internal links.
- Avoid passive voice.
- Use concrete, practical advice.
- Maintain Sendmarc tone.
  `;

  return {
    title: e.title || "Untitled",
    meta: e.meta || "",
    outline,
    styleguide, // ⬅ **Key line**
    gaps: ["Add practical examples", "Include a short checklist"],
    recommended_keywords: ["email security", "DMARC", "domain protection"],
  };
}
