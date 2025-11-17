// src/fetch.ts
import axios from "axios";
import { extractStructure } from "./extract";

const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (compatible; SeoBlogBot/1.0; +https://example.com/bot)";

export async function fastFetch(url: string, timeout = 8000): Promise<string> {
  const res = await axios.get(url, {
    headers: {
      "User-Agent": process.env.FETCH_USER_AGENT || DEFAULT_USER_AGENT,
    },
    timeout,
    responseType: "text",
    validateStatus: (s) => s >= 200 && s < 400,
  });
  return res.data as string;
}

async function runPlaywrightFallback(
  url: string,
  waitForSelector = "article, .post-content, .entry-content",
): Promise<string> {
  // dynamic import to avoid introducing a hard dependency if playright not installed
  let pw: any;
  try {
    pw = require("playwright"); // allow user to install optionally
  } catch (e) {
    throw new Error(
      "Playwright not installed. Install with `npm i -D playwright` or set PLAYWRIGHT_ENABLED=false",
    );
  }

  const browser = await pw.chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({
      viewport: { width: 1366, height: 720 },
    });
    await page.setUserAgent(process.env.FETCH_USER_AGENT || DEFAULT_USER_AGENT);
    await page
      .goto(url, { waitUntil: "networkidle", timeout: 20000 })
      .catch(() => {});
    // try to wait for a semantic selector if present
    try {
      await page.waitForSelector(waitForSelector, { timeout: 3500 });
    } catch (e) {}
    // get either the article or the body as a fallback
    const html = await page.evaluate((sel: string) => {
      const el = document.querySelector(sel) || document.querySelector("body");
      return el ? el.outerHTML : document.documentElement.outerHTML;
    }, waitForSelector);
    return html;
  } finally {
    await browser.close();
  }
}

/**
 * fetchWithFallback(url)
 * - returns: { html: string } or string (legacy)
 * - tries fast fetch + Cheerio extract; if the extracted.main_html is empty or obviously placeholder, it uses Playwright (if enabled)
 */
export async function fetchWithFallback(
  url: string,
): Promise<{ html: string } | string> {
  // 1. fast HTTP fetch
  let rawHtml = "";
  try {
    rawHtml = await fastFetch(url);
  } catch (err) {
    console.warn(
      "fastFetch failed, will try Playwright if enabled:",
      err && (err as Error).message,
    );
    rawHtml = "";
  }

  // 2. attempt Cheerio extraction to quickly decide if page is actionable
  try {
    if (rawHtml && rawHtml.length > 200) {
      const extracted = extractStructure(rawHtml, url);
      const mainHtml =
        extracted && extracted.main_html ? extracted.main_html : "";
      const images = extracted && extracted.images ? extracted.images : [];
      // heuristics to decide whether Playwright is required:
      // - main_html too short
      // - many images but srcs look like placeholder (data gif or blank)
      const isMainShort =
        !mainHtml || mainHtml.replace(/\s+/g, "").length < 120;
      const placeholderImg =
        images.length > 0 &&
        images.every(
          (img) =>
            /data:image\/gif|base64,iVBORw0KGgo/.test(img.src) ||
            img.src.trim() === "",
        );
      if (!isMainShort && !placeholderImg) {
        // Fast path success — return the raw HTML we fetched (server will call extractStructure again)
        return { html: rawHtml };
      }
      // else fallthrough to playwright if enabled
    }
  } catch (e) {
    console.warn(
      "extractStructure check failed, will consider Playwright fallback:",
      e && (e as Error).message,
    );
  }

  // 3. Playwright fallback (if allowed by env)
  const enablePw =
    process.env.PLAYWRIGHT_ENABLED === "true" ||
    (!!process.env.PLAYWRIGHT_ENABLED &&
      process.env.PLAYWRIGHT_ENABLED !== "false");
  if (!enablePw) {
    // return what we have — the server will still try to extract; this is better than throwing
    return { html: rawHtml || "" };
  }

  try {
    const pwHtml = await runPlaywrightFallback(url);
    return { html: pwHtml };
  } catch (e) {
    // if Playwright fails, return the original rawHtml (best-effort)
    console.warn("Playwright fallback failed:", e && (e as Error).message);
    return { html: rawHtml || "" };
  }
}
