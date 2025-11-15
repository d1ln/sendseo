// src/fetch.ts
import fetch from 'node-fetch';
import * as cheerio from 'cheerio';
import { chromium } from 'playwright';

export async function fastFetch(url: string, timeout = 7000) {
  const res = await fetch(url, { headers: { 'User-Agent': 'SeoBot/1.0' }, timeout });
  if (!res.ok) throw new Error('HTTP error ' + res.status);
  const html = await res.text();
  return html;
}

export function analyzeForBrowserNeed(html: string) {
  const $ = cheerio.load(html || '');
  const bodyText = $('body').text().replace(/\s+/g, ' ').trim();
  const bodyLen = bodyText.length;
  const pCount = $('p').length;
  const h1Count = $('h1').length;
  const htmlStr = (html || '').toLowerCase();
  const spaMarkers = ['id="__next"', 'id="root"', 'data-reactroot', 'window.__initialstate__', 'wp-json'];
  const hasSpa = spaMarkers.some(m => htmlStr.includes(m));
  let articleWords = 0;
  const selectors = ['article', '.post', '.entry-content', '#main', '.content'];
  for (const sel of selectors) {
    const text = $(sel).text().replace(/\s+/g, ' ').trim();
    if (text.length > 0) articleWords = Math.max(articleWords, text.split(' ').length);
  }
  const noscriptText = $('noscript').text().replace(/\s+/g, ' ').trim();
  if (articleWords >= 300 && h1Count >= 1) return false;
  if (noscriptText.length > 300) return false;
  if (bodyLen < 500 || pCount < 3) return true;
  if (hasSpa && articleWords < 200) return true;
  return false;
}

export async function fetchWithFallback(url: string) {
  try {
    const html = await fastFetch(url);
    const needBrowser = analyzeForBrowserNeed(html);
    if (!needBrowser) {
      return { html, source: 'fast' };
    }
  } catch (err) {
    // continue to fallback
  }
  // fallback to Playwright
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.route('**/*.{png,jpg,jpeg,gif,webp,svg,woff,woff2}', route => route.abort());
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(()=>null);
    // prefer article-like selectors
    const content = await page.$eval('article, .entry-content, .post, #main', (el) => el.innerHTML).catch(()=>null);
    const rendered = content ? content : await page.content();
    await context.close();
    await browser.close();
    return { html: rendered, source: 'playwright' };
  } catch (err) {
    await browser.close();
    throw err;
  }
}
