/**
 * CiteTrace main-content extraction.
 *
 * Produces a single text string PLUS a segment map so every character of the
 * extracted text can be traced back to the exact DOM text node (and offset)
 * it came from — that mapping is what lets the highlighter wrap matches
 * without ever losing byte-exact restorability.
 *
 * Strategy: <article> → <main> → largest text block (readability-lite:
 * text length × (1 − link density), then descend while one child holds
 * ~all the text).
 */
(() => {
  const NS = (globalThis.CiteTrace = globalThis.CiteTrace || {});
  if (NS.Extract) return;

  const MIN_CHARS = 300; // below this we show the honest "couldn't read" state

  const SKIP_TAGS = new Set([
    "SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "IFRAME", "SVG", "CANVAS",
    "NAV", "FOOTER", "HEADER", "ASIDE", "FORM", "BUTTON", "SELECT",
    "TEXTAREA", "INPUT", "AUDIO", "VIDEO", "DIALOG", "FIGURE",
  ]);

  const BLOCK_TAGS = new Set([
    "P", "DIV", "SECTION", "ARTICLE", "MAIN", "LI", "UL", "OL", "TABLE",
    "TR", "TD", "TH", "BLOCKQUOTE", "PRE", "H1", "H2", "H3", "H4", "H5",
    "H6", "DL", "DT", "DD", "BR", "HR",
  ]);

  function isSkippable(el) {
    if (SKIP_TAGS.has(el.tagName)) return true;
    try {
      if (el.getAttribute("aria-hidden") === "true") return true;
      if (el.hasAttribute("hidden")) return true;
      if (el.hasAttribute("data-citetrace-ui")) return true;
      const style = el.getAttribute("style");
      if (style && /display\s*:\s*none|visibility\s*:\s*hidden/i.test(style)) {
        return true;
      }
    } catch (e) {
      /* detached / foreign nodes — just skip them */
      return true;
    }
    return false;
  }

  function textLen(el) {
    return (el.textContent || "").replace(/\s+/g, " ").trim().length;
  }

  /** Readability-lite: best content container in the document. */
  function pickRoot(doc) {
    const article = doc.querySelector("article");
    if (article && textLen(article) >= MIN_CHARS) return article;
    const main = doc.querySelector("main");
    if (main && textLen(main) >= MIN_CHARS) return main;

    let best = doc.body || doc.documentElement;
    let bestScore = -1;
    const candidates = doc.querySelectorAll("div, section, td, article, main");
    const limit = Math.min(candidates.length, 4000); // hard perf cap
    for (let i = 0; i < limit; i++) {
      const el = candidates[i];
      if (isSkippable(el)) continue;
      const len = textLen(el);
      if (len < MIN_CHARS) continue;
      let linkLen = 0;
      for (const a of el.querySelectorAll("a")) {
        linkLen += (a.textContent || "").length;
      }
      const density = len > 0 ? Math.min(linkLen / len, 1) : 1;
      const score = len * (1 - density);
      if (score > bestScore) {
        bestScore = score;
        best = el;
      }
    }
    // descend while a single child element holds nearly all the text
    let node = best;
    for (let depth = 0; depth < 10; depth++) {
      const total = textLen(node);
      if (total === 0) break;
      let heir = null;
      for (const child of node.children) {
        if (isSkippable(child)) continue;
        if (textLen(child) >= total * 0.9) {
          heir = child;
          break;
        }
      }
      if (!heir) break;
      node = heir;
    }
    return node;
  }

  /**
   * extract(doc) -> {
   *   ok: boolean, reason?: "too-short",
   *   root, text,
   *   segments: [{ start, end, node }]   // text[start,end) === node.nodeValue
   *   meta: { liRanges: [[a,b]], headingEnds: [offset], title }
   * }
   */
  function extract(doc) {
    const root = pickRoot(doc);
    let text = "";
    const segments = [];
    const liRanges = [];
    const headingEnds = [];

    function ensureSeparator() {
      if (text.length > 0 && !/\s$/.test(text)) text += "\n"; // unmapped separator
    }

    function walk(node) {
      if (node.nodeType === Node.TEXT_NODE) {
        const value = node.nodeValue;
        if (!value || !/\S/.test(value)) return;
        segments.push({ start: text.length, end: text.length + value.length, node });
        text += value;
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      if (isSkippable(node)) return;

      const tag = node.tagName;
      const isBlock = BLOCK_TAGS.has(tag);
      const isLi = tag === "LI";
      const isHeading = /^H[1-6]$/.test(tag);
      if (isBlock) ensureSeparator();
      const startLen = text.length;

      for (const child of node.childNodes) walk(child);

      if (isLi && text.length > startLen) liRanges.push([startLen, text.length]);
      if (isHeading && text.length > startLen) headingEnds.push(text.length);
      if (isBlock) ensureSeparator();
    }

    try {
      walk(root);
    } catch (e) {
      /* pathological DOM — fall through to the length check */
    }

    const ok = text.trim().length >= MIN_CHARS;
    return {
      ok,
      reason: ok ? undefined : "too-short",
      root,
      text,
      segments,
      meta: {
        liRanges,
        headingEnds,
        title: doc.title || "",
      },
    };
  }

  NS.Extract = { extract, MIN_CHARS };
})();
