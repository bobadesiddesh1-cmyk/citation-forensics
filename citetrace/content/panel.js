/**
 * CiteTrace forensics side panel — Shadow DOM, never inherits host styles.
 *
 * Look & feel: "forensic lab" — deep harbor-navy surfaces, teal accents,
 * monospace labels. Dark-mode aware via prefers-color-scheme (dark is the
 * default aesthetic; light mode is a pale slate variant).
 */
(() => {
  const NS = (globalThis.CiteTrace = globalThis.CiteTrace || {});
  if (NS.Panel) return;

  let host = null;
  let root = null;
  let state = null; // { job, matchResult, citability, onClear }
  let collapsed = false;

  const CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    .wrap {
      --bg: #0d1b26; --surface: #13293a; --surface2: #0f2231;
      --border: #24455a; --text: #dbe7ee; --muted: #7fb3c8;
      --accent: #14b8a6; --accent-bright: #35d0ba;
      --red: #ef4444; --orange: #f97316;
      --mono: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
      --sans: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
      position: fixed; top: 16px; right: 16px; bottom: 16px;
      width: 380px; max-width: calc(100vw - 32px);
      z-index: 2147483645;
      display: flex; flex-direction: column;
      background: var(--bg); color: var(--text);
      border: 1px solid var(--border); border-radius: 14px;
      box-shadow: 0 18px 50px rgba(0, 10, 20, 0.55);
      font-family: var(--sans); font-size: 13px; line-height: 1.5;
      overflow: hidden;
    }
    @media (prefers-color-scheme: light) {
      .wrap {
        --bg: #f2f7f9; --surface: #ffffff; --surface2: #e8f0f4;
        --border: #c6dae4; --text: #14252f; --muted: #4a6b7c;
        --accent: #0d9488; --accent-bright: #0f766e;
        box-shadow: 0 18px 50px rgba(30, 60, 80, 0.25);
      }
    }
    .wrap.collapsed { display: none; }
    .fab {
      position: fixed; top: 50%; right: 0; transform: translateY(-50%);
      z-index: 2147483645; cursor: pointer;
      background: #0d1b26; color: #35d0ba;
      border: 1px solid #24455a; border-right: none;
      border-radius: 10px 0 0 10px; padding: 12px 9px;
      font: 700 12px/1 ui-monospace, Menlo, monospace;
      letter-spacing: 0.08em; writing-mode: vertical-rl;
      box-shadow: -4px 4px 18px rgba(0, 10, 20, 0.4);
      display: none;
    }
    .fab.visible { display: block; }
    header {
      padding: 12px 14px 10px; border-bottom: 1px solid var(--border);
      background: var(--surface2);
    }
    .brand-row { display: flex; align-items: center; gap: 8px; }
    .brand {
      font: 800 13px/1 var(--mono); letter-spacing: 0.12em; color: var(--text);
      flex: 1;
    }
    .brand em { color: var(--accent-bright); font-style: normal; }
    .icon-btn {
      cursor: pointer; background: transparent; border: 1px solid var(--border);
      color: var(--muted); border-radius: 7px; font: 600 11px/1 var(--mono);
      padding: 5px 8px;
    }
    .icon-btn:hover { color: var(--text); border-color: var(--accent); }
    .src { margin-top: 8px; font-size: 12px; word-break: break-all; }
    .src a { color: var(--accent-bright); text-decoration: none; }
    .traced-from { color: var(--muted); font: 600 10px/1.6 var(--mono);
      letter-spacing: 0.06em; text-transform: uppercase; }
    .coverage {
      margin-top: 8px; padding: 7px 10px; border-radius: 8px;
      background: var(--surface); border: 1px solid var(--border);
      font: 600 11px/1.5 var(--mono);
    }
    .coverage b { color: var(--accent-bright); font-size: 14px; }
    .coverage-bar { height: 5px; border-radius: 99px; background: var(--surface2);
      border: 1px solid var(--border); margin-top: 5px; overflow: hidden; }
    .coverage-fill { height: 100%; background: linear-gradient(90deg, var(--accent), #7dd3fc); }
    nav { display: flex; border-bottom: 1px solid var(--border); background: var(--surface2); }
    nav button {
      flex: 1; cursor: pointer; background: transparent; border: none;
      border-bottom: 2px solid transparent; color: var(--muted);
      font: 700 10px/1 var(--mono); letter-spacing: 0.05em; text-transform: uppercase;
      padding: 10px 4px;
    }
    nav button.active { color: var(--accent-bright); border-bottom-color: var(--accent); }
    nav button:hover { color: var(--text); }
    .content { flex: 1; overflow-y: auto; padding: 12px; background: var(--bg); }
    .card {
      background: var(--surface); border: 1px solid var(--border);
      border-radius: 10px; padding: 10px 12px; margin-bottom: 10px;
    }
    .card.clickable { cursor: pointer; }
    .card.clickable:hover { border-color: var(--accent); }
    .badge {
      display: inline-block; font: 700 9px/1 var(--mono); letter-spacing: 0.08em;
      padding: 3px 8px; border-radius: 999px; margin-bottom: 6px;
    }
    .badge-verbatim { background: rgba(239,68,68,0.18); color: #ff9797; border: 1px solid var(--red); }
    .badge-paraphrase { background: rgba(249,115,22,0.16); color: #ffb27a; border: 1px solid var(--orange); }
    .badge-none { background: var(--surface2); color: var(--muted); border: 1px solid var(--border); }
    @media (prefers-color-scheme: light) {
      .badge-verbatim { color: #b91c1c; }
      .badge-paraphrase { color: #c2410c; }
    }
    .ans { font-size: 12.5px; }
    .excerpt {
      margin-top: 7px; padding: 6px 9px; border-radius: 6px; font-size: 11.5px;
      color: var(--muted);
    }
    .excerpt.v { background: rgba(239,68,68,0.10); border-left: 3px solid var(--red); }
    .excerpt.p { background: rgba(249,115,22,0.10); border-left: 3px solid var(--orange); }
    .sim { font: 600 10px/1 var(--mono); color: var(--muted); margin-left: 6px; }
    .empty { color: var(--muted); text-align: center; padding: 28px 10px; font-size: 12px; }
    .note {
      font-size: 11px; color: var(--muted); background: var(--surface2);
      border: 1px dashed var(--border); border-radius: 8px; padding: 8px 10px;
      margin-bottom: 10px;
    }
    h4.sec { font: 700 10px/1 var(--mono); letter-spacing: 0.08em; color: var(--muted);
      text-transform: uppercase; margin: 14px 0 8px; }
    table.stats { width: 100%; border-collapse: collapse; font-size: 11.5px; }
    table.stats td {
      border: 1px solid var(--border); padding: 6px 8px; vertical-align: top;
    }
    table.stats td:last-child { font-family: var(--mono); white-space: nowrap; text-align: right; }
    .takeaway {
      margin-top: 8px; padding: 8px 10px; border-radius: 8px; font-size: 12px;
      background: rgba(20,184,166,0.08); border-left: 3px solid var(--accent);
    }
    footer {
      border-top: 1px solid var(--border); background: var(--surface2);
      padding: 10px 12px;
    }
    .footer-row { display: flex; gap: 8px; }
    .btn {
      flex: 1; cursor: pointer; border-radius: 8px; padding: 8px 10px;
      font: 700 11px/1 var(--mono); letter-spacing: 0.04em;
      border: 1px solid var(--accent); background: rgba(20,184,166,0.12);
      color: var(--accent-bright);
    }
    .btn:hover { background: rgba(20,184,166,0.25); }
    .btn.ghost { border-color: var(--border); background: transparent; color: var(--muted); }
    .btn.ghost:hover { color: var(--text); border-color: var(--muted); }
    .privacy { margin-top: 8px; font-size: 10px; color: var(--muted); text-align: center; }
    .match-card {
      position: fixed; z-index: 2147483646; width: 300px; max-width: calc(100vw - 40px);
      background: var(--bg); color: var(--text); border: 1px solid var(--accent);
      border-radius: 10px; padding: 10px 12px; font-family: var(--sans); font-size: 12px;
      box-shadow: 0 14px 40px rgba(0, 10, 20, 0.6);
    }
    .match-card .close { float: right; cursor: pointer; color: var(--muted);
      font: 700 12px/1 var(--mono); background: none; border: none; }
    .fig { font-family: var(--mono); color: #ffb27a; }
    .errbox { padding: 20px 14px; text-align: center; }
    .errbox .big { font-size: 26px; margin-bottom: 10px; }
  `;

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function badge(tier, extra) {
    const b = el("span", "badge badge-" + tier);
    b.textContent =
      tier === "verbatim" ? "VERBATIM" : tier === "paraphrase" ? "PARAPHRASE" : "NOT FOUND HERE";
    if (extra) b.textContent += " · " + extra;
    return b;
  }

  function ensureHost() {
    if (host && host.isConnected) return;
    host = document.createElement("div");
    host.setAttribute("data-citetrace-ui", "1");
    root = host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = CSS;
    root.appendChild(style);
    document.documentElement.appendChild(host);
  }

  function unmount() {
    try {
      if (host) host.remove();
    } catch (e) {
      /* ignore */
    }
    host = null;
    root = null;
    state = null;
  }

  // ── header / chrome ────────────────────────────────────────────────────

  function buildChrome(job, onClear) {
    const wrap = el("div", "wrap");

    const fab = el("div", "fab", "◂ CITETRACE");
    fab.addEventListener("click", () => {
      collapsed = false;
      wrap.classList.remove("collapsed");
      fab.classList.remove("visible");
    });

    const header = el("header");
    const brandRow = el("div", "brand-row");
    const brand = el("div", "brand");
    brand.appendChild(el("em", null, "CITE"));
    brand.appendChild(document.createTextNode("TRACE"));
    const collapseBtn = el("button", "icon-btn", "▸ hide");
    collapseBtn.title = "Collapse panel (highlights stay)";
    collapseBtn.addEventListener("click", () => {
      collapsed = true;
      wrap.classList.add("collapsed");
      fab.classList.add("visible");
    });
    const clearBtn = el("button", "icon-btn", "✕ clear");
    clearBtn.title = "Remove all highlights and restore the page exactly";
    clearBtn.addEventListener("click", () => {
      try {
        if (onClear) onClear();
      } finally {
        unmount();
      }
    });
    brandRow.append(brand, collapseBtn, clearBtn);
    header.appendChild(brandRow);

    const src = el("div", "src");
    const tracedFrom = el(
      "div",
      "traced-from",
      "traced from " + (job.aiSite || "AI chat")
    );
    const link = el("a", null, job.sourceDomain || job.sourceUrl);
    link.href = job.sourceUrl;
    link.addEventListener("click", (e) => e.preventDefault()); // already here
    src.append(tracedFrom, link);
    header.appendChild(src);

    return { wrap, fab, header };
  }

  // ── tabs ───────────────────────────────────────────────────────────────

  function renderMatches(container, m) {
    container.textContent = "";
    const matched = m.sentences.filter((s) => s.tier !== "none");
    if (matched.length === 0) {
      container.appendChild(
        el("div", "empty", "No verbatim or paraphrase matches found in this source.")
      );
      return;
    }
    for (const s of matched) {
      const card = el("div", "card clickable");
      card.title = "Click to scroll to the highlighted passage";
      const extra =
        s.tier === "paraphrase" && s.paraphrase
          ? Math.round(s.paraphrase.similarity * 100) + "%"
          : s.verbatimRuns.length > 0
            ? s.verbatimRuns[0].words + " words"
            : null;
      card.appendChild(badge(s.tier, extra));
      card.appendChild(el("div", "ans", s.text));
      for (const r of s.verbatimRuns) {
        card.appendChild(el("div", "excerpt v", "“" + r.text + "”"));
      }
      if (s.paraphrase) {
        const ex = el("div", "excerpt p", "“" + s.paraphrase.sourceText + "”");
        card.appendChild(ex);
      }
      const firstHl = m.highlights.find((h) => h.answerIndex === s.index);
      if (firstHl) {
        card.addEventListener("click", () => NS.Highlighter.scrollTo(firstHl.id));
      }
      container.appendChild(card);
    }
  }

  function renderNotFound(container, m) {
    container.textContent = "";
    const note = el(
      "div",
      "note",
      "These answer sentences were not found in THIS source. They may be supported " +
        "by the AI's other citations — absence here does not mean they are false."
    );
    container.appendChild(note);
    if (m.notFound.length === 0) {
      container.appendChild(
        el("div", "empty", "Every answer sentence matched this source.")
      );
    }
    for (const i of m.notFound) {
      const card = el("div", "card");
      card.appendChild(badge("none"));
      card.appendChild(el("div", "ans", m.sentences[i].text));
      container.appendChild(card);
    }
    if (m.figures.unverified.length > 0) {
      container.appendChild(el("h4", "sec", "Unverified figures"));
      const note2 = el(
        "div",
        "note",
        "Numbers from the answer that don't appear in this page's text " +
          "(exact match after removing commas — unit conversions are not detected)."
      );
      container.appendChild(note2);
      for (const f of m.figures.unverified) {
        const card = el("div", "card");
        const fig = el("span", "fig", f.raw);
        card.appendChild(fig);
        card.appendChild(
          el("div", "ans", "from: “" + (m.sentences[f.sentenceIndex] || { text: "" }).text + "”")
        );
        container.appendChild(card);
      }
    }
  }

  function renderCitability(container, citability) {
    container.textContent = "";
    if (!citability) {
      container.appendChild(el("div", "empty", "No citability data for this page."));
      return;
    }
    const s = citability.stats;
    const note = el(
      "div",
      "note",
      "What the passages the AI cited have in common — reverse-engineer the " +
        "structure AI engines quote, then shape your own content the same way."
    );
    container.appendChild(note);

    const table = el("table", "stats");
    const rows = [
      ["Source sentences cited", s.citedCount + " / " + (s.citedCount + s.uncitedCount)],
      ["Avg words — cited", String(s.avgWordsCited)],
      ["Avg words — uncited", String(s.avgWordsUncited)],
      ["Cited position: first third", s.positionPct.first + "%"],
      ["Cited position: middle third", s.positionPct.middle + "%"],
      ["Cited position: last third", s.positionPct.last + "%"],
      ["Cited sentences w/ a number", s.numberPctCited + "% (uncited " + s.numberPctUncited + "%)"],
      ["Cited sentences in list items", s.listPctCited + "%"],
      ["Cited directly after heading", s.headingPctCited + "%"],
    ];
    for (const [k, v] of rows) {
      const tr = el("tr");
      tr.appendChild(el("td", null, k));
      tr.appendChild(el("td", null, v));
      table.appendChild(tr);
    }
    container.appendChild(table);

    container.appendChild(el("h4", "sec", "Takeaways"));
    for (const t of citability.takeaways) {
      container.appendChild(el("div", "takeaway", t));
    }
  }

  // ── public: full forensics panel ───────────────────────────────────────

  function mount({ job, matchResult, citability, onClear }) {
    try {
      ensureHost();
      state = { job, matchResult, citability, onClear };
      // clear previous panel body (keep style node)
      for (const n of [...root.children]) {
        if (n.tagName !== "STYLE") n.remove();
      }

      const m = matchResult;
      const { wrap, fab, header } = buildChrome(job, onClear);

      const coverage = el("div", "coverage");
      const covText = el("div");
      covText.append(
        document.createTextNode("AI answer used ~"),
        el("b", null, m.coverage.pct + "%"),
        document.createTextNode(" of this page")
      );
      const bar = el("div", "coverage-bar");
      const fill = el("div", "coverage-fill");
      fill.style.width = Math.min(m.coverage.pct, 100) + "%";
      bar.appendChild(fill);
      coverage.append(covText, bar);
      header.appendChild(coverage);
      wrap.appendChild(header);

      // tabs
      const nav = el("nav");
      const content = el("div", "content");
      const verbatimCount = m.sentences.filter((x) => x.tier === "verbatim").length;
      const paraphraseCount = m.sentences.filter((x) => x.tier === "paraphrase").length;
      const tabs = [
        {
          label: `Matches (${verbatimCount + paraphraseCount})`,
          render: () => renderMatches(content, m),
        },
        {
          label: `Not found (${m.notFound.length})`,
          render: () => renderNotFound(content, m),
        },
        { label: "Citability", render: () => renderCitability(content, citability) },
      ];
      const btns = tabs.map((t, i) => {
        const b = el("button", i === 0 ? "active" : "", t.label);
        b.addEventListener("click", () => {
          btns.forEach((x) => x.classList.remove("active"));
          b.classList.add("active");
          t.render();
        });
        nav.appendChild(b);
        return b;
      });
      wrap.append(nav, content);
      tabs[0].render();

      // footer
      const footer = el("footer");
      const row = el("div", "footer-row");
      const exportBtn = el("button", "btn", "⬇ EXPORT REPORT");
      exportBtn.addEventListener("click", () => {
        NS.Report.download({ job, matchResult: m, citability });
      });
      row.append(exportBtn);
      footer.appendChild(row);
      footer.appendChild(
        el(
          "div",
          "privacy",
          "100% local text matching — CiteTrace makes no network requests and sends data nowhere."
        )
      );
      wrap.appendChild(footer);

      root.append(wrap, fab);
      if (collapsed) {
        wrap.classList.add("collapsed");
        fab.classList.add("visible");
      }
    } catch (e) {
      /* the panel failing must never break the page */
    }
  }

  // ── public: honest failure state ───────────────────────────────────────

  function mountError({ job, message, onClear }) {
    try {
      ensureHost();
      for (const n of [...root.children]) {
        if (n.tagName !== "STYLE") n.remove();
      }
      const { wrap, fab, header } = buildChrome(job, onClear);
      wrap.appendChild(header);
      const box = el("div", "content");
      const err = el("div", "errbox");
      err.appendChild(el("div", "big", "🕳️"));
      err.appendChild(el("div", "ans", message));
      box.appendChild(err);
      wrap.appendChild(box);
      const footer = el("footer");
      footer.appendChild(
        el(
          "div",
          "privacy",
          "100% local text matching — CiteTrace makes no network requests and sends data nowhere."
        )
      );
      wrap.appendChild(footer);
      root.append(wrap, fab);
    } catch (e) {
      /* silent */
    }
  }

  // ── public: floating card for highlight clicks ────────────────────────

  let openCard = null;

  function showMatchCard(highlightInfo, rect) {
    try {
      if (!root || !state) return;
      hideMatchCard();
      const m = state.matchResult;
      const sent = m.sentences[highlightInfo.answerIndex];
      if (!sent) return;

      const card = el("div", "match-card");
      const close = el("button", "close", "✕");
      close.addEventListener("click", hideMatchCard);
      card.appendChild(close);
      const extra =
        highlightInfo.tier === "paraphrase"
          ? Math.round(highlightInfo.similarity * 100) + "% similar"
          : "exact run";
      card.appendChild(badge(highlightInfo.tier, extra));
      card.appendChild(el("div", "traced-from", "matches this AI answer sentence"));
      card.appendChild(el("div", "ans", sent.text));

      // position near the click, clamped to viewport
      const top = Math.min(Math.max(rect.bottom + 8, 10), window.innerHeight - 160);
      const left = Math.min(Math.max(rect.left, 10), window.innerWidth - 320);
      card.style.top = top + "px";
      card.style.left = left + "px";
      root.appendChild(card);
      openCard = card;

      setTimeout(() => {
        document.addEventListener("click", dismissOnOutsideClick, {
          capture: true,
          once: true,
        });
      }, 0);
    } catch (e) {
      /* silent */
    }
  }

  function dismissOnOutsideClick() {
    hideMatchCard();
  }

  function hideMatchCard() {
    if (openCard) {
      openCard.remove();
      openCard = null;
    }
  }

  NS.Panel = { mount, mountError, unmount, showMatchCard };
})();
