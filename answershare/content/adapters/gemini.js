/**
 * AnswerShare adapter: gemini.google.com.
 * Same contract as adapters/chatgpt.js (which also defines NS.AdapterUtils —
 * a guarded copy lives here in case load order ever changes).
 * Opaque grounding redirects (vertexsearch…) can't be unwrapped locally; we
 * log the redirect host and open them as-is when tracing (fragments usually
 * survive HTTP redirects).
 */
(() => {
  const NS = (globalThis.CiteTrace = globalThis.CiteTrace || {});
  NS.Adapters = NS.Adapters || {};
  if (NS.Adapters.gemini) return;

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
  const INTERNAL =
    /(^|\.)(gemini\.google\.com|accounts\.google\.com|support\.google\.com|myaccount\.google\.com|gstatic\.com|googleusercontent\.com)$/;

  function isStreaming(container) {
    try {
      if (container.querySelector("[class*='streaming'], [class*='typing'], blinking-cursor")) {
        return true;
      }
      return !!document.querySelector("button[aria-label*='Stop response']");
    } catch (e) {
      return false;
    }
  }

  function citationsIn(container) {
    const out = [];
    const seen = new Set();
    let rank = 0;
    const scopes = [];
    for (const sel of [
      "sources-list",
      "[class*='sources']",
      "[class*='citation']",
      "[class*='attribution']",
    ]) {
      for (const s of container.querySelectorAll(sel)) scopes.push(s);
    }
    if (scopes.length === 0) scopes.push(container);
    for (const scope of scopes) {
      for (const a of scope.querySelectorAll("a[href]")) {
        const href = U.unwrapRedirect(a.href);
        if (!U.isExternal(href, INTERNAL)) continue;
        if (seen.has(href)) continue;
        seen.add(href);
        rank += 1;
        out.push({ url: href, title: U.cleanTitle(a), marker: null, rank, el: a });
      }
      if (out.length > 0 && scope !== container) break;
    }
    return out;
  }

  function queryEls() {
    return [
      ...document.querySelectorAll("user-query, [class*='user-query'], [class*='query-text']"),
    ].filter((e) => (e.innerText || "").trim().length > 0);
  }

  function fromContainers(containers) {
    const qs = queryEls();
    const out = [];
    for (const el of containers) {
      if (isStreaming(el)) continue;
      const answerText = (el.innerText || "").trim();
      if (answerText.length < 20) continue;
      const citations = citationsIn(el);
      if (citations.length === 0) continue;
      out.push({ query: U.precedingQuery(el, qs), answerText, citations });
    }
    return out;
  }

  function extractExchanges() {
    // Strategy 1: Angular custom elements (current DOM)
    try {
      const els = document.querySelectorAll("model-response, message-content");
      if (els.length > 0) {
        const out = fromContainers(els);
        if (out.length > 0) return out;
      }
    } catch (e) {
      /* fall through */
    }
    // Strategy 2: response containers by class
    try {
      const els = document.querySelectorAll(
        ".model-response-text, [class*='response-container'], [class*='model-response']"
      );
      if (els.length > 0) {
        const out = fromContainers(els);
        if (out.length > 0) return out;
      }
    } catch (e) {
      /* fall through */
    }
    // Strategy 3: whole main area (last resort)
    try {
      const main = document.querySelector("main") || document.body;
      return main ? fromContainers([main]) : [];
    } catch (e) {
      return [];
    }
  }

  NS.Adapters.gemini = {
    site: "Gemini",
    hostPattern: /(^|\.)gemini\.google\.com$/,
    settingsKey: "enableGemini",
    extractExchanges,
  };
})();
