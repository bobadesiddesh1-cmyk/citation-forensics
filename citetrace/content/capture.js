/**
 * CiteTrace capture — runs on the AI chat pages.
 * Finds completed answers + their citations via the site adapter, injects a
 * 🔍 Trace button next to every citation, and on click creates a trace job
 * (answer pre-split into sentences) then asks the background worker to open
 * the source tab with #citetrace={jobId} appended.
 */
(() => {
  const NS = (globalThis.CiteTrace = globalThis.CiteTrace || {});
  if (NS.__captureLoaded) return;
  NS.__captureLoaded = true;

  const DEBOUNCE_MS = 1000; // MutationObserver settle time
  const processed = new WeakSet(); // citation anchors we already decorated
  let adapter = null;
  let enabled = true;
  let debounceTimer = null;
  let toastHost = null;

  function pickAdapter() {
    try {
      const host = location.hostname;
      for (const key of Object.keys(NS.Adapters || {})) {
        if (NS.Adapters[key].hostPattern.test(host)) return NS.Adapters[key];
      }
    } catch (e) {
      /* silent no-op */
    }
    return null;
  }

  function isPdfUrl(url) {
    try {
      const u = new URL(url);
      return /\.pdf($|[?#])/i.test(u.pathname + u.search);
    } catch (e) {
      return /\.pdf($|[?#])/i.test(url);
    }
  }

  function newJobId() {
    const bytes = new Uint8Array(8);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  }

  // ── toast (Shadow DOM, bottom-right) ──────────────────────────────────

  function toast(message, kind) {
    try {
      if (!toastHost || !toastHost.isConnected) {
        toastHost = document.createElement("div");
        toastHost.setAttribute("data-citetrace-ui", "1");
        toastHost.style.cssText =
          "position:fixed;bottom:24px;right:24px;z-index:2147483646;";
        toastHost.attachShadow({ mode: "open" });
        document.documentElement.appendChild(toastHost);
      }
      const root = toastHost.shadowRoot;
      const el = document.createElement("div");
      el.textContent = message;
      el.style.cssText = [
        "font:600 13px/1.4 ui-monospace,'SF Mono',Menlo,Consolas,monospace",
        "background:" + (kind === "warn" ? "#3d2b12" : "#0d2b26"),
        "color:" + (kind === "warn" ? "#ffc978" : "#5eead4"),
        "border:1px solid " + (kind === "warn" ? "#a16207" : "#14b8a6"),
        "border-radius:10px",
        "padding:10px 16px",
        "margin-top:8px",
        "box-shadow:0 8px 24px rgba(0,0,0,0.35)",
        "max-width:340px",
        "opacity:0",
        "transition:opacity .25s ease",
      ].join(";");
      root.appendChild(el);
      requestAnimationFrame(() => (el.style.opacity = "1"));
      setTimeout(() => {
        el.style.opacity = "0";
        setTimeout(() => el.remove(), 300);
      }, 3500);
    } catch (e) {
      /* never break the host page */
    }
  }

  // ── trace button injection (Shadow DOM, unobtrusive) ──────────────────

  function makeTraceButton(onClick) {
    const host = document.createElement("span");
    host.setAttribute("data-citetrace-ui", "1");
    host.style.cssText =
      "display:inline-block;vertical-align:baseline;margin:0 2px;line-height:1;";
    const root = host.attachShadow({ mode: "open" });
    const btn = document.createElement("button");
    btn.type = "button";
    btn.title = "CiteTrace: open this source and see exactly what the AI used";
    btn.textContent = "🔍 Trace";
    btn.style.cssText = [
      "all:initial",
      "cursor:pointer",
      "font:600 10px/1 ui-monospace,'SF Mono',Menlo,Consolas,monospace",
      "letter-spacing:0.04em",
      "color:#0d9488",
      "background:rgba(20,184,166,0.12)",
      "border:1px solid rgba(20,184,166,0.45)",
      "border-radius:999px",
      "padding:3px 7px",
      "vertical-align:baseline",
      "white-space:nowrap",
      "transition:background .15s ease",
    ].join(";");
    btn.addEventListener("mouseenter", () => {
      btn.style.background = "rgba(20,184,166,0.28)";
    });
    btn.addEventListener("mouseleave", () => {
      btn.style.background = "rgba(20,184,166,0.12)";
    });
    btn.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      onClick();
    });
    root.appendChild(btn);
    return host;
  }

  // ── trace job creation ────────────────────────────────────────────────

  function onTrace(answer, citation) {
    try {
      if (isPdfUrl(citation.url)) {
        toast("PDF tracing not supported yet — CiteTrace works on HTML pages.", "warn");
        return;
      }
      const jobId = newJobId();
      const sentences = NS.Tokenizer.splitSentences(answer.answerText).map(
        (s) => s.text
      );
      if (sentences.length === 0) {
        toast("Couldn't read the answer text for this message.", "warn");
        return;
      }
      const job = {
        jobId,
        sourceUrl: citation.url,
        sourceDomain: safeDomain(citation.url),
        sourceTitle: citation.title || "",
        answerText: answer.answerText,
        sentences,
        aiSite: adapter.site,
        createdAt: Date.now(),
      };
      // replace any existing fragment with ours (documented in DECISIONS.md)
      const openUrl = citation.url.split("#")[0] + "#citetrace=" + jobId;
      chrome.runtime.sendMessage(
        { type: "CITETRACE_OPEN_TRACE", job, url: openUrl },
        (resp) => {
          if (chrome.runtime.lastError || !resp || !resp.ok) {
            toast("CiteTrace couldn't open the source tab.", "warn");
          }
        }
      );
      toast("Opening source — forensics will run in the new tab…");
    } catch (e) {
      toast("CiteTrace hit an unexpected error starting this trace.", "warn");
    }
  }

  function safeDomain(url) {
    try {
      return new URL(url).hostname.replace(/^www\./, "");
    } catch (e) {
      return "";
    }
  }

  // ── scanning loop ─────────────────────────────────────────────────────

  function scan() {
    if (!enabled || !adapter) return;
    let answers;
    try {
      answers = adapter.extractAnswers();
    } catch (e) {
      return; // adapter failed entirely → silent no-op
    }
    if (!Array.isArray(answers)) return;
    for (const answer of answers) {
      if (!answer || !Array.isArray(answer.citations)) continue;
      for (const citation of answer.citations) {
        try {
          const el = citation.el;
          if (!el || processed.has(el) || !el.isConnected) continue;
          processed.add(el);
          const btn = makeTraceButton(() => onTrace(answer, citation));
          el.insertAdjacentElement("afterend", btn);
        } catch (e) {
          /* one bad citation never stops the rest */
        }
      }
    }
  }

  function scheduleScan() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(scan, DEBOUNCE_MS);
  }

  async function init() {
    adapter = pickAdapter();
    if (!adapter) return; // unknown host → silent no-op

    try {
      const settings = await NS.Storage.getSettings();
      enabled = settings[adapter.settingsKey] !== false;
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== "local" || !changes.citetrace_settings) return;
        const next = changes.citetrace_settings.newValue || {};
        enabled = next[adapter.settingsKey] !== false;
        if (enabled) scheduleScan();
      });
    } catch (e) {
      enabled = true; // storage unavailable — default on
    }

    try {
      const observer = new MutationObserver((mutations) => {
        // ignore mutation bursts caused purely by our own UI
        for (const m of mutations) {
          for (const n of m.addedNodes) {
            if (n.nodeType === 1 && n.hasAttribute && n.hasAttribute("data-citetrace-ui")) {
              continue;
            }
            scheduleScan();
            return;
          }
          if (m.type === "characterData") {
            scheduleScan();
            return;
          }
        }
      });
      observer.observe(document.body || document.documentElement, {
        childList: true,
        subtree: true,
        characterData: true,
      });
    } catch (e) {
      /* no observer — the initial scan still runs */
    }

    setTimeout(scan, 1500); // initial scan once the page settles
  }

  init();
})();
