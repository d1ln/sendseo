// src/generate.ts
function escapeHtmlMinimal(s: string) {
  return String(s).replace(
    /[&<>"']/g,
    (m) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        m
      ] || "",
  );
}

/**
 * Coerce many possible section shapes into an HTML string.
 */
function coerceSectionToHtml(sec: any): string {
  if (!sec) return "";
  if (typeof sec === "string") return sec;
  if (typeof sec === "object") {
    // direct html fields
    const cands = ["html", "body_html", "body", "content", "text", "snippet"];
    for (const k of cands) {
      const v = sec[k];
      if (typeof v === "string" && v.trim()) return v;
      if (Array.isArray(v) && v.length)
        return v.map((item) => coerceSectionToHtml(item)).join("\n");
      if (typeof v === "object" && v != null) {
        const inner = coerceSectionToHtml(v);
        if (inner) return inner;
      }
    }
    // if object looks like { heading, children/sections }
    if (Array.isArray((sec as any).sections) && (sec as any).sections.length)
      return (sec as any).sections
        .map((s: any) => coerceSectionToHtml(s))
        .join("\n");
    if (Array.isArray((sec as any).blocks) && (sec as any).blocks.length)
      return (sec as any).blocks
        .map((s: any) => coerceSectionToHtml(s))
        .join("\n");
    const heading = sec.heading || sec.title || sec.h2 || "";
    const body = sec.html || sec.body || sec.text || sec.content || "";
    if (heading || body) {
      const head = heading
        ? `<h2>${escapeHtmlMinimal(String(heading))}</h2>`
        : "";
      const bodyStr =
        typeof body === "string"
          ? body
          : escapeHtmlMinimal(JSON.stringify(body));
      return head + `<div>${bodyStr}</div>`;
    }
    try {
      return `<pre>${escapeHtmlMinimal(JSON.stringify(sec, null, 2))}</pre>`;
    } catch {
      return escapeHtmlMinimal(String(sec));
    }
  }
  return escapeHtmlMinimal(String(sec));
}

/**
 * Exposed generateSection wrapper that uses the LLM client (if provided elsewhere)
 * NOTE: we call the global LLM client generateSection via import in llm.ts earlier.
 * Here we rely on that function being available (llm exports).
 */
export async function generateSectionWrapper(h2: string, context: any) {
  // Importing LLM client at runtime to avoid circular issues; llm exports generateSection via getLLMClient wrapper
  const mod = await import("./llm");
  const client = mod.getLLMClient && mod.getLLMClient();
  if (client && typeof client.generateSection === "function") {
    try {
      return await client.generateSection(h2, context);
    } catch (e) {
      console.warn(
        "generateSectionWrapper LLM error:",
        e instanceof Error ? e.message : String(e),
      );
    }
  }
  // fallback stub
  const html = `<h2>${escapeHtmlMinimal(h2)}</h2><p>This is a generated paragraph for ${escapeHtmlMinimal(h2)}. Replace with LLM output.</p>`;
  return { html, word_count: html.split(/\s+/).length };
}

export async function assembleDraft(outline: any[], brief: any) {
  const sections: string[] = [];
  for (const s of outline) {
    const h2 =
      typeof s === "string" ? s : s.h2 || s.title || s.heading || String(s);
    // call wrapper
    const sec = await generateSectionWrapper(h2, { brief, section: s });
    const html = coerceSectionToHtml(sec);
    // safety sanitization: ensure no <a> tags or raw URLs (server will also sanitize, but double-check here)
    const sanitized = html
      .replace(/<a\b[^>]*>/gi, "")
      .replace(/<\/a>/gi, "")
      .replace(/https?:\/\/\S+/gi, "")
      .replace(/www\.\S+/gi, "");
    sections.push(sanitized);
  }
  const body = sections.join("\n");

  // Key takeaways: prefer brief.key_points or empty fallback
  const takeaways =
    (brief &&
      (brief.key_points ||
        brief.key_takeaways ||
        brief.recommended_key_takeaways)) ||
    [];
  let takeawaysHtml = "";
  if (Array.isArray(takeaways) && takeaways.length) {
    takeawaysHtml = `<h4 id="key-takeaways">KEY TAKEAWAYS</h4><ul>${takeaways
      .slice(0, 5)
      .map((t: any) => `<li>${escapeHtmlMinimal(String(t))}</li>`)
      .join("")}</ul>`;
  }

  // JSON-LD
  const jsonld = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: brief?.title || "Article",
    description: brief?.meta || "",
    author: { "@type": "Person", name: "Sendmarc" },
    datePublished: new Date().toISOString(),
  };
  const jsonldHtml = `<script type="application/ld+json">${JSON.stringify(jsonld)}</script>`;

  // Optional 'How to prepare' if no 'how' in outline
  const hasHow = (outline || []).some(
    (o: any) =>
      String((o.h2 || o.title || o).toLowerCase()).includes("how") ||
      String((o.h2 || o.title || o).toLowerCase()).includes("prepare"),
  );
  const prepHtml = hasHow
    ? ""
    : `<h2>How to prepare</h2><ol><li>Audit senders and services.</li><li>Validate SPF/DKIM records.</li><li>Monitor DMARC reports.</li></ol>`;

  const cta = `<p><strong>Next steps:</strong> Review your email authentication setup and consider Sendmarc best practices.</p>`;

  const finalBody = `${jsonldHtml}\n${takeawaysHtml}\n${body}\n${prepHtml}\n${cta}`;

  return {
    title: brief?.title || "Untitled",
    meta: brief?.meta || "",
    body_html: finalBody,
  };
}
