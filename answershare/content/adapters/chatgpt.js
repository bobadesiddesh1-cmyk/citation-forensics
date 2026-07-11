/**
 * AnswerShare adapter: chatgpt.com (and legacy chat.openai.com).
 * Contract: NS.Adapters.chatgpt.extractExchanges() ->
 *   [{ query, answerText, citations: [{url, title?, marker?, rank, el}] }]
 * `el` is the citation's DOM node (button injection target); pure data
 * consumers never see it. Every strategy is try/catch — failure returns [].
 */
(() => {
  const NS = (globalThis.CiteTrace = globalThis.CiteTrace || {});
  NS.Adapters = NS.Adapters || {};
  if (NS.Adapters.chatgpt) return;

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
      /** Last element in `queryEls` that precedes `el` in document order. */
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
  const INTERNAL = /(^|\.)(chatgpt\.com|openai\.com|oaiusercontent\.com|oaistatic\.com)$/;

  function isStreaming(msgEl) {
    try {
      if (msgEl.querySelector(".result-streaming, [class*='streaming']")) return true;
      const stop = document.querySelector(
        "button[data-testid*='stop'], button[aria-label*='Stop streaming']"
      );
      const all = document.querySelectorAll('[data-message-author-role="assistant"]');
      if (stop && all.length && msgEl === all[all.length - 1]) return true;
      return false;
    } catch (e) {
      return false;
    }
  }

  function citationsIn(msgEl) {
    const out = [];
    const seen = new Set();
    let rank = 0;
    for (const a of msgEl.querySelectorAll("a[href]")) {
      const href = U.unwrapRedirect(a.href);
      if (!U.isExternal(href, INTERNAL)) continue;
      const key = href;
      if (seen.has(key)) continue;
      seen.add(key);
      rank += 1;
      out.push({ url: href, title: U.cleanTitle(a), marker: null, rank, el: a });
    }
    return out;
  }

  function queryEls() {
    return [...document.querySelectorAll('[data-message-author-role="user"]')];
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
    // Strategy 1: role-tagged assistant messages (current DOM)
    try {
      const els = document.querySelectorAll('[data-message-author-role="assistant"]');
      if (els.length > 0) {
        const out = fromContainers(els);
        if (out.length > 0) return out;
      }
    } catch (e) {
      /* fall through */
    }
    // Strategy 2: agent-turn wrappers (older DOM)
    try {
      const els = document.querySelectorAll("div.agent-turn, [class*='agent-turn']");
      if (els.length > 0) {
        const out = fromContainers(els);
        if (out.length > 0) return out;
      }
    } catch (e) {
      /* fall through */
    }
    // Strategy 3: markdown blocks inside main (last resort)
    try {
      return fromContainers(document.querySelectorAll("main .markdown"));
    } catch (e) {
      return [];
    }
  }

  NS.Adapters.chatgpt = {
    site: "ChatGPT",
    hostPattern: /(^|\.)(chatgpt\.com|chat\.openai\.com)$/,
    settingsKey: "enableChatgpt",
    extractExchanges,
  };
})();
