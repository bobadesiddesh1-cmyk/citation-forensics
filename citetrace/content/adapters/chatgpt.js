/**
 * CiteTrace adapter: chatgpt.com (and legacy chat.openai.com).
 * Contract: NS.Adapters.chatgpt.extractAnswers() ->
 *   [{ answerText, citations: [{ url, title?, marker?, el }] }]
 * `el` (the anchor/chip DOM node) is an extension to the base contract so
 * capture.js knows where to inject the Trace button (see DECISIONS.md).
 * Every strategy is wrapped in try/catch — an adapter that fails returns [].
 */
(() => {
  const NS = (globalThis.CiteTrace = globalThis.CiteTrace || {});
  NS.Adapters = NS.Adapters || {};
  if (NS.Adapters.chatgpt) return;

  // Shared adapter utilities — defined once by whichever adapter loads first.
  if (!NS.AdapterUtils) {
    NS.AdapterUtils = {
      /** Unwrap common redirect-wrapped hrefs (google/url?q=, ?url=, ?u=…). */
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
      /** External http(s) link that leaves the AI site itself. */
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
  const INTERNAL = /(^|\.)(chatgpt\.com|openai\.com|oaiusercontent\.com|oaistatic\.com)$/;

  function isStreaming(msgEl) {
    try {
      if (msgEl.querySelector(".result-streaming, [class*='streaming']")) return true;
      // a visible global stop button means the last message is still generating
      const stop = document.querySelector(
        "button[data-testid*='stop'], button[aria-label*='Stop streaming']"
      );
      if (stop && msgEl === lastAssistantEl()) return true;
      return false;
    } catch (e) {
      return false;
    }
  }

  function lastAssistantEl() {
    const all = document.querySelectorAll('[data-message-author-role="assistant"]');
    return all.length ? all[all.length - 1] : null;
  }

  function citationsIn(msgEl) {
    const out = [];
    const seen = new Set();
    for (const a of msgEl.querySelectorAll("a[href]")) {
      const href = U.unwrapRedirect(a.href);
      if (!U.isExternal(href, INTERNAL)) continue;
      const key = href + "::" + (a.textContent || "").trim();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ url: href, title: U.cleanTitle(a), marker: null, el: a });
    }
    return out;
  }

  function fromContainers(containers) {
    const answers = [];
    for (const el of containers) {
      if (isStreaming(el)) continue;
      const answerText = (el.innerText || "").trim();
      if (answerText.length < 20) continue;
      const citations = citationsIn(el);
      if (citations.length > 0) answers.push({ answerText, citations });
    }
    return answers;
  }

  function extractAnswers() {
    // Strategy 1: role-tagged assistant messages (current DOM)
    try {
      const els = document.querySelectorAll('[data-message-author-role="assistant"]');
      if (els.length > 0) {
        const answers = fromContainers(els);
        if (answers.length > 0) return answers;
      }
    } catch (e) {
      /* fall through */
    }

    // Strategy 2: agent-turn wrappers (older DOM)
    try {
      const els = document.querySelectorAll("div.agent-turn, [class*='agent-turn']");
      if (els.length > 0) {
        const answers = fromContainers(els);
        if (answers.length > 0) return answers;
      }
    } catch (e) {
      /* fall through */
    }

    // Strategy 3: markdown blocks inside main (last resort)
    try {
      const els = document.querySelectorAll("main .markdown");
      return fromContainers(els);
    } catch (e) {
      return [];
    }
  }

  NS.Adapters.chatgpt = {
    site: "ChatGPT",
    hostPattern: /(^|\.)(chatgpt\.com|chat\.openai\.com)$/,
    settingsKey: "enableChatgpt",
    extractAnswers,
  };
})();
