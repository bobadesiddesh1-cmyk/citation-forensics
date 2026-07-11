/**
 * CiteTrace adapter: gemini.google.com.
 * Same contract as adapters/chatgpt.js (which also defines NS.AdapterUtils —
 * a guarded copy lives here too in case load order ever changes).
 *
 * Note: some Gemini citations are opaque grounding redirects
 * (vertexsearch.cloud.google.com/grounding-api-redirect/…) whose target is
 * not present in the URL. Those cannot be unwrapped locally; the trace
 * fragment usually survives the HTTP redirect (browsers propagate fragments
 * when the Location header has none), so we open them as-is.
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
    };
  }

  const U = NS.AdapterUtils;
  // gstatic/googleusercontent are asset hosts; vertexsearch redirects are
  // real (opaque) citations, so they are NOT listed as internal.
  const INTERNAL =
    /(^|\.)(gemini\.google\.com|accounts\.google\.com|support\.google\.com|myaccount\.google\.com|gstatic\.com|googleusercontent\.com)$/;

  function isStreaming(container) {
    try {
      if (
        container.querySelector(
          "[class*='streaming'], [class*='typing'], blinking-cursor"
        )
      ) {
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
    // Prefer the sources/chips area when present
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
        const key = href;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ url: href, title: U.cleanTitle(a), marker: null, el: a });
      }
      if (out.length > 0 && scope !== container) break; // chips found — done
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
    // Strategy 1: Angular custom elements (current DOM)
    try {
      const els = document.querySelectorAll("model-response, message-content");
      if (els.length > 0) {
        const answers = fromContainers(els);
        if (answers.length > 0) return answers;
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
        const answers = fromContainers(els);
        if (answers.length > 0) return answers;
      }
    } catch (e) {
      /* fall through */
    }

    // Strategy 3: whole main area as one answer (last resort)
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
    extractAnswers,
  };
})();
