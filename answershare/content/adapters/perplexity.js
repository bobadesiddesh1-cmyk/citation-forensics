/**
 * AnswerShare adapter: perplexity.ai.
 * Same contract as adapters/chatgpt.js (which also defines NS.AdapterUtils —
 * a guarded copy lives here in case load order ever changes).
 */
(() => {
  const NS = (globalThis.CiteTrace = globalThis.CiteTrace || {});
  NS.Adapters = NS.Adapters || {};
  if (NS.Adapters.perplexity) return;

  if (!NS.AdapterUtils) {
    NS.AdapterUtils = {
      unwrapRedirect(href) {
        try {
          const u = new URL(href);
          if (/(^|\.)google\.[a-z.]+$/.test(u.hostname) && u.pathname === "/url") {
            const target = u.searchParams.get("q") || u.searchParams.get("url");
            if (target && /^https?:\/\//.test(target)) return target;
          }
          for (const key of ["url", "u", "target", "dest", "redirect_url"]) {
            const v = u.searchParams.get(key);
            if (v && /^https?:\/\//.test(v)) return v;
          }
          return href;
        } catch (e) {
          return href;
        }
      },
      isExternal(href, internalHostRe) {
        try {
          const u = new URL(href);
          if (u.protocol !== "http:" && u.protocol !== "https:") return false;
          return !internalHostRe.test(u.hostname);
        } catch (e) {
          return false;
        }
      },
      cleanTitle(a) {
        const t = (a.getAttribute("title") || a.textContent || "").trim();
        return t.length > 120 ? t.slice(0, 117) + "…" : t;
      },
      precedingQuery(el, queryEls) {
        let best = null;
        for (const q of queryEls) {
          const pos = q.compareDocumentPosition(el);
          if (pos & Node.DOCUMENT_POSITION_FOLLOWING) best = q;
        }
        return best ? (best.innerText || "").trim() : "";
      },
    };
  }

  const U = NS.AdapterUtils;
  const INTERNAL = /(^|\.)(perplexity\.ai|pplx\.ai)$/;

  function isStreaming() {
    try {
      return !!document.querySelector(
        "button[aria-label*='Stop'], [class*='animate-pulse'][class*='cursor']"
      );
    } catch (e) {
      return false;
    }
  }

  function markerOf(a) {
    const t = (a.textContent || "").trim();
    const m = t.match(/^\[?(\d{1,2})\]?$/);
    return m ? m[1] : null;
  }

  function citationsIn(container) {
    const out = [];
    const seen = new Set();
    let rank = 0;
    const anchors = container.querySelectorAll("a.citation, a[class*='citation'], a[href]");
    const hasChips = !!container.querySelector("a.citation, a[class*='citation']");
    for (const a of anchors) {
      const href = U.unwrapRedirect(a.href);
      if (!U.isExternal(href, INTERNAL)) continue;
      const isChip = a.matches("a.citation, a[class*='citation']") || markerOf(a) !== null;
      if (!isChip && hasChips) continue; // prose links aren't citations when chips exist
      const key = href;
      if (seen.has(key)) continue;
      seen.add(key);
      rank += 1;
      out.push({ url: href, title: U.cleanTitle(a), marker: markerOf(a), rank, el: a });
    }
    return out;
  }

  function queryEls() {
    // Perplexity shows the query as a heading above each answer block
    const els = [
      ...document.querySelectorAll(
        "h1[class*='query'], [class*='query'] h1, [data-testid*='query'], main h1"
      ),
    ];
    return els.filter((e) => (e.innerText || "").trim().length > 0);
  }

  function fromContainers(containers) {
    if (isStreaming()) return [];
    const qs = queryEls();
    const out = [];
    for (const el of containers) {
      const answerText = (el.innerText || "").trim();
      if (answerText.length < 20) continue;
      const citations = citationsIn(el);
      if (citations.length === 0) continue;
      out.push({ query: U.precedingQuery(el, qs), answerText, citations });
    }
    return out;
  }

  function extractExchanges() {
    // Strategy 1: prose answer blocks (current DOM)
    try {
      const els = document.querySelectorAll("div.prose, [class*='prose']");
      if (els.length > 0) {
        const out = fromContainers(els);
        if (out.length > 0) return out;
      }
    } catch (e) {
      /* fall through */
    }
    // Strategy 2: answer containers by test id
    try {
      const els = document.querySelectorAll(
        "[data-testid*='answer'], [class*='answer'] [class*='markdown']"
      );
      if (els.length > 0) {
        const out = fromContainers(els);
        if (out.length > 0) return out;
      }
    } catch (e) {
      /* fall through */
    }
    // Strategy 3: whole main area as one exchange (last resort)
    try {
      const main = document.querySelector("main");
      return main ? fromContainers([main]) : [];
    } catch (e) {
      return [];
    }
  }

  NS.Adapters.perplexity = {
    site: "Perplexity",
    hostPattern: /(^|\.)perplexity\.ai$/,
    settingsKey: "enablePerplexity",
    extractExchanges,
  };
})();
