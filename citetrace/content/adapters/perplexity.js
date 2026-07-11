/**
 * CiteTrace adapter: perplexity.ai.
 * Same contract as adapters/chatgpt.js (which also defines NS.AdapterUtils —
 * a guarded copy lives here too in case load order ever changes).
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
    };
  }

  const U = NS.AdapterUtils;
  const INTERNAL = /(^|\.)(perplexity\.ai|pplx\.ai)$/;

  function isStreaming() {
    try {
      // Perplexity shows a stop button / animated cursor while generating
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
    const anchors = container.querySelectorAll(
      "a.citation, a[class*='citation'], a[href]"
    );
    for (const a of anchors) {
      const href = U.unwrapRedirect(a.href);
      if (!U.isExternal(href, INTERNAL)) continue;
      const isChip =
        a.matches("a.citation, a[class*='citation']") || markerOf(a) !== null;
      // in the prose area we only take citation chips; plain external links
      // inside the answer body are usually part of the text itself
      if (!isChip && container.querySelector("a.citation, a[class*='citation']")) {
        continue;
      }
      const key = href + "::" + (a.textContent || "").trim();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ url: href, title: U.cleanTitle(a), marker: markerOf(a), el: a });
    }
    return out;
  }

  function fromContainers(containers) {
    if (isStreaming()) return [];
    const answers = [];
    for (const el of containers) {
      const answerText = (el.innerText || "").trim();
      if (answerText.length < 20) continue;
      const citations = citationsIn(el);
      if (citations.length > 0) answers.push({ answerText, citations });
    }
    return answers;
  }

  function extractAnswers() {
    // Strategy 1: prose answer blocks (current DOM)
    try {
      const els = document.querySelectorAll("div.prose, [class*='prose']");
      if (els.length > 0) {
        const answers = fromContainers(els);
        if (answers.length > 0) return answers;
      }
    } catch (e) {
      /* fall through */
    }

    // Strategy 2: answer containers by test id / copy area
    try {
      const els = document.querySelectorAll(
        "[data-testid*='answer'], [class*='answer'] [class*='markdown']"
      );
      if (els.length > 0) {
        const answers = fromContainers(els);
        if (answers.length > 0) return answers;
      }
    } catch (e) {
      /* fall through */
    }

    // Strategy 3: whole main area as one answer (last resort)
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
    extractAnswers,
  };
})();
