/**
 * AnswerShare capture — runs on the AI chat pages.
 *
 * Two jobs:
 *  1. PASSIVE LOGGING: every completed answer with citations is recorded
 *     locally (query, site, citation domains + ranks, answer text) — no
 *     clicks needed. A small toast says whether your domain was cited.
 *  2. TRACE BUTTONS: a 🔎 Why? button next to each citation opens the
 *     source with the forensics engine (verbatim/paraphrase highlights +
 *     the citability profile of the winning passages).
 */
(() => {
  const NS = (globalThis.CiteTrace = globalThis.CiteTrace || {});
  if (NS.__asCaptureLoaded) return;
  NS.__asCaptureLoaded = true;

  const DEBOUNCE_MS = 1000;
  const processed = new WeakSet(); // citation anchors already decorated
  let adapter = null;
  let settings = null;
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

  function newId() {
    const bytes = new Uint8Array(8);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  }

  // ── toast (Shadow DOM, bottom-right) ──────────────────────────────────

  function toast(message, kind) {
    try {
      if (settings && settings.captureToasts === false && kind !== "warn") return;
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
      const palette = {
        ok: ["#0d2b26", "#5eead4", "#14b8a6"],
        warn: ["#3d2b12", "#ffc978", "#a16207"],
        lost: ["#2d1215", "#ff9b9b", "#b91c1c"],
      }[kind || "ok"];
      el.style.cssText = [
        "font:600 12px/1.4 ui-monospace,'SF Mono',Menlo,Consolas,monospace",
        "background:" + palette[0],
        "color:" + palette[1],
        "border:1px solid " + palette[2],
        "border-radius:10px",
        "padding:10px 16px",
        "margin-top:8px",
        "box-shadow:0 8px 24px rgba(0,0,0,0.35)",
        "max-width:360px",
        "opacity:0",
        "transition:opacity .25s ease",
      ].join(";");
      root.appendChild(el);
      requestAnimationFrame(() => (el.style.opacity = "1"));
      setTimeout(() => {
        el.style.opacity = "0";
        setTimeout(() => el.remove(), 300);
      }, 4200);
    } catch (e) {
      /* never break the host page */
    }
  }

  // ── passive record logging ────────────────────────────────────────────

  async function logExchange(ex) {
    try {
      const citations = ex.citations.map((c) => ({
        url: c.url,
        domain: NS.ASStorage.domainOf(c.url),
        rank: c.rank,
        title: c.title || "",
      }));
      const added = await NS.ASStorage.addRecord({
        id: newId(),
        ts: Date.now(),
        query: (ex.query || "").slice(0, 500),
        aiSite: adapter.site,
        citations,
        answerText: ex.answerText,
      });
      if (!added) return; // duplicate — already logged

      const mine = settings.myDomains || [];
      if (mine.length > 0) {
        const hit = citations.find((c) => NS.ASStorage.matchesDomainList(c.domain, mine));
        if (hit) {
          toast(`📡 AnswerShare · logged · your domain cited #${hit.rank} 🎉`, "ok");
        } else {
          toast(
            `📡 AnswerShare · logged · your domain NOT cited (${citations.length} sources)`,
            "lost"
          );
        }
      } else {
        toast(`📡 AnswerShare logged · ${citations.length} citations`, "ok");
      }
    } catch (e) {
      /* logging must never break the chat page */
    }
  }

  // ── trace buttons (Shadow DOM, unobtrusive) ───────────────────────────

  function makeTraceButton(onClick) {
    const host = document.createElement("span");
    host.setAttribute("data-citetrace-ui", "1");
    host.style.cssText =
      "display:inline-block;vertical-align:baseline;margin:0 2px;line-height:1;";
    const root = host.attachShadow({ mode: "open" });
    const btn = document.createElement("button");
    btn.type = "button";
    btn.title = "AnswerShare: open this source and see why it got cited";
    btn.textContent = "🔎 Why?";
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
      "white-space:nowrap",
      "transition:background .15s ease",
    ].join(";");
    btn.addEventListener("mouseenter", () => (btn.style.background = "rgba(20,184,166,0.28)"));
    btn.addEventListener("mouseleave", () => (btn.style.background = "rgba(20,184,166,0.12)"));
    btn.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      onClick();
    });
    root.appendChild(btn);
    return host;
  }

  function onTrace(ex, citation) {
    try {
      if (isPdfUrl(citation.url)) {
        toast("PDF tracing not supported yet — AnswerShare works on HTML pages.", "warn");
        return;
      }
      const jobId = newId();
      const sentences = NS.Tokenizer.splitSentences(ex.answerText).map((s) => s.text);
      if (sentences.length === 0) {
        toast("Couldn't read the answer text for this message.", "warn");
        return;
      }
      const job = {
        jobId,
        mode: "trace",
        sourceUrl: citation.url,
        sourceDomain: NS.ASStorage.domainOf(citation.url),
        sourceTitle: citation.title || "",
        query: ex.query || "",
        answerText: ex.answerText,
        sentences,
        aiSite: adapter.site,
        createdAt: Date.now(),
      };
      const openUrl = citation.url.split("#")[0] + "#answershare=" + jobId;
      chrome.runtime.sendMessage(
        { type: "ANSWERSHARE_OPEN_JOB", job, url: openUrl },
        (resp) => {
          if (chrome.runtime.lastError || !resp || !resp.ok) {
            toast("AnswerShare couldn't open the source tab.", "warn");
          }
        }
      );
      toast("Opening source — the why-they-won analysis runs in the new tab…");
    } catch (e) {
      toast("AnswerShare hit an unexpected error starting this trace.", "warn");
    }
  }

  // ── scanning loop ─────────────────────────────────────────────────────

  function scan() {
    if (!enabled || !adapter) return;
    let exchanges;
    try {
      exchanges = adapter.extractExchanges();
    } catch (e) {
      return; // adapter failed entirely → silent no-op
    }
    if (!Array.isArray(exchanges)) return;
    for (const ex of exchanges) {
      if (!ex || !Array.isArray(ex.citations)) continue;
      logExchange(ex); // dedupe happens in storage
      for (const citation of ex.citations) {
        try {
          const el = citation.el;
          if (!el || processed.has(el) || !el.isConnected) continue;
          processed.add(el);
          const btn = makeTraceButton(() => onTrace(ex, citation));
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
    if (!adapter) return;

    try {
      settings = await NS.ASStorage.getSettings();
      enabled = settings[adapter.settingsKey] !== false;
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== "local" || !changes.answershare_settings) return;
        settings = {
          ...NS.ASStorage.DEFAULT_SETTINGS,
          ...(changes.answershare_settings.newValue || {}),
        };
        enabled = settings[adapter.settingsKey] !== false;
        if (enabled) scheduleScan();
      });
    } catch (e) {
      settings = { ...NS.ASStorage.DEFAULT_SETTINGS };
      enabled = true;
    }

    try {
      const observer = new MutationObserver((mutations) => {
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

    setTimeout(scan, 1500);
  }

  init();
})();
