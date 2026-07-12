/**
 * AnswerShare dashboard — share of voice, loss list, win/loss compare,
 * records, settings. All data from chrome.storage.local via shared/storage.js.
 */
(() => {
  const NS = globalThis.CiteTrace;
  const S = NS.ASStorage;
  const $ = (id) => document.getElementById(id);

  let records = [];
  let profiles = [];
  let settings = null;

  const BROAD_ORIGINS = ["https://*/*", "http://*/*"];

  // ── optional host permission ("enable page analysis") ────────────────

  async function hasAnalysisPermission() {
    try {
      return await chrome.permissions.contains({ origins: BROAD_ORIGINS });
    } catch (e) {
      return false;
    }
  }

  /** Must be called from a user-gesture handler (button click). */
  async function requestAnalysisPermission() {
    try {
      const ok = await chrome.permissions.request({ origins: BROAD_ORIGINS });
      if (ok) {
        await new Promise((resolve) =>
          chrome.runtime.sendMessage({ type: "ANSWERSHARE_PERMISSION_GRANTED" }, () =>
            resolve()
          )
        );
      }
      await refreshPermissionUi();
      return ok;
    } catch (e) {
      return false;
    }
  }

  async function refreshPermissionUi() {
    const granted = await hasAnalysisPermission();
    const banner = $("perm-banner");
    if (banner) banner.hidden = granted;
    const status = $("perm-status");
    if (status) status.textContent = granted ? "enabled ✓" : "not enabled";
    const enable2 = $("perm-enable-2");
    if (enable2) enable2.hidden = granted;
    const revoke = $("perm-revoke");
    if (revoke) revoke.hidden = !granted;
    return granted;
  }

  // ── helpers ────────────────────────────────────────────────────────────

  const fmtDate = (ts) => {
    try {
      const d = new Date(ts);
      return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
    } catch (e) {
      return "";
    }
  };

  const esc = (s) => String(s == null ? "" : s);

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function myHit(record) {
    return (record.citations || []).find((c) =>
      S.matchesDomainList(c.domain, settings.myDomains)
    );
  }

  function competitorHit(record) {
    const comp = settings.competitorDomains || [];
    if (comp.length > 0) {
      return (record.citations || []).find((c) => S.matchesDomainList(c.domain, comp));
    }
    // no competitor list: any non-you citation counts as competition
    return (record.citations || []).find(
      (c) => !S.matchesDomainList(c.domain, settings.myDomains)
    );
  }

  function filteredRecords() {
    const topic = $("f-topic").value;
    const days = parseInt($("f-range").value, 10);
    const engine = $("f-engine").value;
    const cutoff = days > 0 ? Date.now() - days * 86400000 : 0;
    return records.filter((r) => {
      if (r.ts < cutoff) return false;
      if (engine && r.aiSite !== engine) return false;
      if (topic && S.topicOf(r.query, settings.topics) !== topic) return false;
      return true;
    });
  }

  // ── overview ───────────────────────────────────────────────────────────

  function renderOverview() {
    const rows = filteredRecords();
    const hasMine = (settings.myDomains || []).length > 0;
    $("setup-hint").hidden = hasMine;

    // KPIs
    $("k-queries").textContent = String(rows.length);
    const cited = rows.filter((r) => myHit(r)).length;
    const share = rows.length > 0 && hasMine ? Math.round((cited / rows.length) * 100) : null;
    const shareEl = $("k-share");
    shareEl.textContent = share == null ? "–" : share + "%";
    shareEl.classList.toggle("bad", share != null && share < 25);

    // domain shares
    const counts = new Map(); // domain -> #records citing it
    for (const r of rows) {
      const seen = new Set();
      for (const c of r.citations || []) {
        if (!c.domain || seen.has(c.domain)) continue;
        seen.add(c.domain);
        counts.set(c.domain, (counts.get(c.domain) || 0) + 1);
      }
    }
    const ranked = [...counts.entries()]
      .map(([domain, n]) => ({ domain, pct: Math.round((n / Math.max(rows.length, 1)) * 100), n }))
      .sort((a, b) => b.n - a.n);

    const topComp = ranked.find((d) => !S.matchesDomainList(d.domain, settings.myDomains));
    $("k-top").textContent = topComp ? topComp.pct + "%" : "–";
    $("k-top").title = topComp ? topComp.domain : "";

    // leaderboard
    const lb = $("leaderboard");
    lb.textContent = "";
    const top = ranked.slice(0, 10);
    // ensure your domain appears even outside the top 10
    if (hasMine && !top.some((d) => S.matchesDomainList(d.domain, settings.myDomains))) {
      const mine = ranked.find((d) => S.matchesDomainList(d.domain, settings.myDomains));
      top.push(mine || { domain: settings.myDomains[0] + " (you)", pct: 0, n: 0 });
    }
    if (top.length === 0) {
      lb.appendChild(el("div", "empty", "No citations captured for this filter yet."));
    }
    for (const d of top) {
      const isYou = S.matchesDomainList(d.domain, settings.myDomains);
      const isComp = S.matchesDomainList(d.domain, settings.competitorDomains);
      const row = el("div", "lb-row" + (isYou ? " you" : isComp ? " competitor" : ""));
      row.appendChild(el("span", "dom", d.domain + (isYou ? " (you)" : "")));
      const track = el("span", "track");
      const fill = el("span", "fill");
      fill.style.width = Math.min(d.pct, 100) + "%";
      track.appendChild(fill);
      row.appendChild(track);
      row.appendChild(el("span", "pct", d.pct + "%"));
      lb.appendChild(row);
    }

    // trend: weekly share (last 8 weeks, ignores range filter cutoff wider than 8w)
    renderTrend(hasMine);

    // loss list
    const body = $("loss-table").querySelector("tbody");
    body.textContent = "";
    const losses = hasMine ? rows.filter((r) => !myHit(r) && competitorHit(r)) : [];
    $("k-losses").textContent = String(losses.length);
    $("loss-empty").hidden = losses.length > 0;
    $("loss-empty").textContent = hasMine
      ? "No losses in this filter — either you're winning or nothing was captured yet."
      : "Set your domain in Settings to see the loss list.";
    for (const r of losses.slice().reverse().slice(0, 50)) {
      const winner = competitorHit(r) || (r.citations || [])[0];
      const tr = el("tr");
      const q = el("td", "q", r.query || "(query not captured)");
      q.title = r.query || "";
      tr.appendChild(q);
      tr.appendChild(el("td", "mono", r.aiSite));
      tr.appendChild(el("td", "mono", fmtDate(r.ts)));
      const wtd = el("td");
      wtd.appendChild(el("span", "pill winner", winner ? winner.domain + " #" + winner.rank : "?"));
      tr.appendChild(wtd);
      const act = el("td");
      if (winner && r.answerText) {
        const b = el("span", "pill act", "ANALYZE WHY →");
        b.addEventListener("click", () => analyzeWhy(r, winner));
        act.appendChild(b);
      }
      tr.appendChild(act);
      body.appendChild(tr);
    }
  }

  function renderTrend(hasMine) {
    const svg = $("trend");
    const labels = $("trend-labels");
    svg.textContent = "";
    labels.textContent = "";
    const WEEKS = 8;
    const now = Date.now();
    const pts = [];
    for (let w = WEEKS - 1; w >= 0; w--) {
      const from = now - (w + 1) * 7 * 86400000;
      const to = now - w * 7 * 86400000;
      const bucket = records.filter((r) => r.ts >= from && r.ts < to);
      const cited = bucket.filter((r) => myHit(r)).length;
      pts.push({
        share: hasMine && bucket.length > 0 ? (cited / bucket.length) * 100 : null,
        n: bucket.length,
        label: w === 0 ? "this wk" : w + "w ago",
      });
    }
    const W = 600;
    const H = 90;
    const step = W / (WEEKS - 1);
    const y = (v) => H - 8 - (v / 100) * (H - 20);
    // grid
    for (const g of [0, 50, 100]) {
      const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
      line.setAttribute("x1", "0");
      line.setAttribute("x2", String(W));
      line.setAttribute("y1", String(y(g)));
      line.setAttribute("y2", String(y(g)));
      line.setAttribute("stroke", "currentColor");
      line.setAttribute("opacity", "0.12");
      svg.appendChild(line);
    }
    let d = "";
    pts.forEach((p, i) => {
      if (p.share == null) return;
      const cmd = d === "" ? "M" : "L";
      d += `${cmd}${i * step},${y(p.share)} `;
    });
    if (d) {
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", d.trim());
      path.setAttribute("fill", "none");
      path.setAttribute("stroke", "#14b8a6");
      path.setAttribute("stroke-width", "2.5");
      path.setAttribute("stroke-linecap", "round");
      svg.appendChild(path);
      pts.forEach((p, i) => {
        if (p.share == null) return;
        const c = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        c.setAttribute("cx", String(i * step));
        c.setAttribute("cy", String(y(p.share)));
        c.setAttribute("r", i === pts.length - 1 ? "4.5" : "3");
        c.setAttribute("fill", "#35d0ba");
        const t = document.createElementNS("http://www.w3.org/2000/svg", "title");
        t.textContent = Math.round(p.share) + "% of " + p.n + " queries";
        c.appendChild(t);
        svg.appendChild(c);
      });
    } else {
      const t = document.createElementNS("http://www.w3.org/2000/svg", "text");
      t.setAttribute("x", String(W / 2));
      t.setAttribute("y", String(H / 2));
      t.setAttribute("text-anchor", "middle");
      t.setAttribute("fill", "currentColor");
      t.setAttribute("opacity", "0.5");
      t.setAttribute("font-size", "12");
      t.textContent = hasMine
        ? "no captures yet — the trend appears as data accumulates"
        : "set your domain in Settings to see your trend";
      svg.appendChild(t);
    }
    for (const p of pts) labels.appendChild(el("span", null, p.label));
  }

  // ── analyze-why (trace job from a stored record) ──────────────────────

  function newId() {
    const bytes = new Uint8Array(8);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  }

  async function analyzeWhy(record, citation) {
    if (!(await ensurePermissionOrPrompt())) return;
    const jobId = newId();
    const sentences = NS.Tokenizer.splitSentences(record.answerText).map((s) => s.text);
    if (sentences.length === 0) return;
    const job = {
      jobId,
      mode: "trace",
      sourceUrl: citation.url,
      sourceDomain: citation.domain,
      sourceTitle: citation.title || "",
      query: record.query || "",
      answerText: record.answerText,
      sentences,
      aiSite: record.aiSite,
      createdAt: Date.now(),
    };
    const openUrl = citation.url.split("#")[0] + "#answershare=" + jobId;
    chrome.runtime.sendMessage({ type: "ANSWERSHARE_OPEN_JOB", job, url: openUrl });
  }

  // ── win/loss view ─────────────────────────────────────────────────────

  function renderWinLoss() {
    const body = $("profiles-table").querySelector("tbody");
    body.textContent = "";
    $("profiles-empty").hidden = profiles.length > 0;
    for (const p of profiles.slice().reverse()) {
      const tr = el("tr");
      const kind = el("td");
      kind.appendChild(
        el("span", "pill kind-" + p.kind, p.kind === "winner" ? "WINNER" : "MINE")
      );
      tr.appendChild(kind);
      const u = el("td", "mono", p.domain);
      u.title = p.url;
      tr.appendChild(u);
      tr.appendChild(el("td", "q", p.query || "—"));
      tr.appendChild(el("td", "mono", fmtDate(p.ts)));
      body.appendChild(tr);
    }

    // compare selects
    const w = $("cmp-winner");
    const m = $("cmp-mine");
    const keepW = w.value;
    const keepM = m.value;
    w.length = 1;
    m.length = 1;
    for (const p of profiles.slice().reverse()) {
      const opt = document.createElement("option");
      opt.value = p.id;
      opt.textContent = `${p.domain} — ${(p.query || p.url).slice(0, 60)}`;
      (p.kind === "winner" ? w : m).appendChild(opt);
    }
    w.value = keepW;
    m.value = keepM;
    renderCompare();
  }

  function statOf(p, key) {
    // winner profiles carry citability stats; mine profiles carry page stats
    const s = p.stats || {};
    const map = {
      avgWords: p.kind === "winner" ? s.avgWordsCited : s.avgWords,
      numberPct: p.kind === "winner" ? s.numberPctCited : s.numberPct,
      listPct: p.kind === "winner" ? s.listPctCited : s.listPct,
      headingPct: p.kind === "winner" ? s.headingPctCited : s.headingPct,
    };
    return map[key] ?? 0;
  }

  function renderCompare() {
    const out = $("compare-out");
    out.textContent = "";
    const w = profiles.find((p) => p.id === $("cmp-winner").value);
    const m = profiles.find((p) => p.id === $("cmp-mine").value);
    if (!w || !m) return;

    const duel = el("div", "duel");
    const mk = (p, cls, title) => {
      const col = el("div", "duel-col " + cls);
      col.appendChild(el("h4", null, title));
      col.appendChild(el("div", "u", p.url));
      const rows =
        p.kind === "winner"
          ? [
              ["Avg words (cited passages)", statOf(p, "avgWords")],
              ["Cited sentences w/ number", statOf(p, "numberPct") + "%"],
              ["Cited in list items", statOf(p, "listPct") + "%"],
              ["Cited under a heading", statOf(p, "headingPct") + "%"],
              ["Answer used of page", (p.stats.coveragePct ?? 0) + "%"],
              [
                "Cited position (1st/mid/last)",
                `${p.stats.positionPct?.first ?? 0}/${p.stats.positionPct?.middle ?? 0}/${p.stats.positionPct?.last ?? 0}%`,
              ],
            ]
          : [
              ["Avg words (all sentences)", statOf(p, "avgWords")],
              ["Sentences w/ number", statOf(p, "numberPct") + "%"],
              ["Sentences in list items", statOf(p, "listPct") + "%"],
              ["Sentences under a heading", statOf(p, "headingPct") + "%"],
              ["Sentences", p.stats.sentenceCount ?? 0],
            ];
      for (const [k, v] of rows) {
        const r = el("div", "stat-row");
        r.appendChild(el("span", null, k));
        r.appendChild(el("b", null, String(v)));
        col.appendChild(r);
      }
      return col;
    };
    duel.appendChild(mk(w, "win", "▲ winner — " + w.domain));
    duel.appendChild(mk(m, "lose", "▼ yours — " + m.domain));
    out.appendChild(duel);

    // deterministic gap recommendations
    const fixes = [];
    const wWords = statOf(w, "avgWords");
    const mWords = statOf(m, "avgWords");
    if (wWords > 0 && mWords > wWords * 1.15) {
      fixes.push(
        `Their cited passages average ${wWords} words; your sentences average ${mWords}. Tighten — aim for ${Math.round(wWords)}-word, self-contained statements.`
      );
    }
    const dNum = statOf(w, "numberPct") - statOf(m, "numberPct");
    if (dNum >= 15) {
      fixes.push(
        `${statOf(w, "numberPct")}% of the winning passages contain a number vs ${statOf(m, "numberPct")}% of your sentences — lead with concrete figures.`
      );
    }
    const dHead = statOf(w, "headingPct") - statOf(m, "headingPct");
    if (statOf(w, "headingPct") >= 20 && dHead >= 10) {
      fixes.push(
        `${statOf(w, "headingPct")}% of winning passages sit directly under a heading — front-load each section with its key fact, right after the H2/H3.`
      );
    }
    const dList = statOf(w, "listPct") - statOf(m, "listPct");
    if (statOf(w, "listPct") >= 20 && dList >= 10) {
      fixes.push(
        `${statOf(w, "listPct")}% of winning passages live in list items — convert your key claims into scannable bullets.`
      );
    }
    if ((w.stats.positionPct?.first ?? 0) >= 50) {
      fixes.push(
        `${w.stats.positionPct.first}% of the winning passages sit in the opening third of the page — move your key claims up.`
      );
    }
    if (fixes.length === 0) {
      fixes.push(
        "Structurally you're close to the winner — the gap is likely topical coverage or authority, not sentence shape. Check what the winning passage says that your page doesn't."
      );
    }
    const fx = el("div", "fixes");
    fixes.slice(0, 4).forEach((f, i) => {
      const row = el("div", "fix");
      row.appendChild(el("span", "fn", String(i + 1)));
      row.appendChild(el("span", null, f));
      fx.appendChild(row);
    });
    out.appendChild(fx);
  }

  /** Ensure analysis permission, prompting if needed. Calls permissions.request
   *  directly (no awaited contains() first) so the click's user gesture is
   *  preserved — request() is a silent no-op that resolves true when the
   *  permission is already held. Must be reached synchronously from a click. */
  async function ensurePermissionOrPrompt() {
    return requestAnalysisPermission();
  }

  async function profileMyPage() {
    const url = $("profile-url").value.trim();
    if (!/^https?:\/\//.test(url)) {
      $("profile-url").focus();
      return;
    }
    if (!(await ensurePermissionOrPrompt())) return;
    const jobId = newId();
    const job = {
      jobId,
      mode: "profile",
      sourceUrl: url,
      sourceDomain: S.domainOf(url),
      createdAt: Date.now(),
    };
    const openUrl = url.split("#")[0] + "#answershare=" + jobId;
    chrome.runtime.sendMessage({ type: "ANSWERSHARE_OPEN_JOB", job, url: openUrl });
  }

  // ── records view ──────────────────────────────────────────────────────

  function renderRecords() {
    const q = $("rec-search").value.trim().toLowerCase();
    const body = $("records-table").querySelector("tbody");
    body.textContent = "";
    const rows = records
      .filter((r) => {
        if (!q) return true;
        return (
          (r.query || "").toLowerCase().includes(q) ||
          (r.citations || []).some((c) => (c.domain || "").includes(q))
        );
      })
      .slice()
      .reverse();
    $("records-empty").hidden = rows.length > 0;
    for (const r of rows.slice(0, 200)) {
      const tr = el("tr");
      tr.appendChild(el("td", "mono", fmtDate(r.ts)));
      tr.appendChild(el("td", "mono", r.aiSite));
      const qtd = el("td", "q", r.query || "(query not captured)");
      qtd.title = r.query || "";
      tr.appendChild(qtd);
      tr.appendChild(
        el("td", "mono", (r.citations || []).map((c) => `#${c.rank} ${c.domain}`).join("  "))
      );
      const you = el("td");
      const hit = myHit(r);
      if ((settings.myDomains || []).length === 0) {
        you.appendChild(el("span", "pill winner", "SET DOMAIN"));
      } else if (hit) {
        you.appendChild(el("span", "pill won", "CITED #" + hit.rank));
      } else {
        you.appendChild(el("span", "pill lost", "NOT CITED"));
      }
      tr.appendChild(you);
      body.appendChild(tr);
    }
  }

  function csvEscape(v) {
    const s = String(v == null ? "" : v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function exportCsv() {
    const header = ["date", "ai_site", "query", "citations_ranked", "your_domain_cited"];
    const lines = [header.join(",")];
    for (const r of records) {
      lines.push(
        [
          new Date(r.ts).toISOString(),
          r.aiSite,
          r.query,
          (r.citations || []).map((c) => `#${c.rank} ${c.domain}`).join(" | "),
          myHit(r) ? "yes" : "no",
        ]
          .map(csvEscape)
          .join(",")
      );
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "answershare-records-" + Date.now() + ".csv";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  // ── settings view ─────────────────────────────────────────────────────

  function loadSettingsForm() {
    $("s-mine").value = (settings.myDomains || []).join(", ");
    $("s-competitors").value = (settings.competitorDomains || []).join(", ");
    $("s-topics").value = (settings.topics || [])
      .map((t) => `${t.name}: ${(t.keywords || []).join(", ")}`)
      .join("\n");
    $("s-chatgpt").checked = settings.enableChatgpt !== false;
    $("s-perplexity").checked = settings.enablePerplexity !== false;
    $("s-gemini").checked = settings.enableGemini !== false;
    $("s-toasts").checked = settings.captureToasts !== false;
  }

  async function saveSettingsForm() {
    const parseList = (v) =>
      v.split(",").map((s) => s.trim().toLowerCase().replace(/^www\./, "")).filter(Boolean);
    const topics = $("s-topics")
      .value.split("\n")
      .map((line) => {
        const i = line.indexOf(":");
        if (i < 0) return null;
        const name = line.slice(0, i).trim();
        const keywords = line.slice(i + 1).split(",").map((k) => k.trim()).filter(Boolean);
        return name && keywords.length ? { name, keywords } : null;
      })
      .filter(Boolean);
    await S.setSettings({
      myDomains: parseList($("s-mine").value),
      competitorDomains: parseList($("s-competitors").value),
      topics,
      enableChatgpt: $("s-chatgpt").checked,
      enablePerplexity: $("s-perplexity").checked,
      enableGemini: $("s-gemini").checked,
      captureToasts: $("s-toasts").checked,
    });
    settings = await S.getSettings();
    $("s-saved").hidden = false;
    setTimeout(() => ($("s-saved").hidden = true), 1800);
    refreshTopicFilter();
    renderAll();
  }

  function refreshTopicFilter() {
    const sel = $("f-topic");
    const keep = sel.value;
    sel.length = 1;
    for (const t of settings.topics || []) {
      const opt = document.createElement("option");
      opt.value = t.name;
      opt.textContent = t.name;
      sel.appendChild(opt);
    }
    sel.value = keep;
  }

  // ── view switching + init ─────────────────────────────────────────────

  function switchView(name) {
    for (const b of document.querySelectorAll("#views button")) {
      b.classList.toggle("active", b.dataset.view === name);
    }
    for (const v of document.querySelectorAll(".view")) {
      v.hidden = v.id !== "view-" + name;
    }
  }

  function renderAll() {
    renderOverview();
    renderWinLoss();
    renderRecords();
  }

  async function init() {
    settings = await S.getSettings();
    records = await S.getRecords();
    profiles = await S.getProfiles();
    refreshTopicFilter();
    loadSettingsForm();
    renderAll();

    document.querySelectorAll("#views button").forEach((b) => {
      b.addEventListener("click", () => switchView(b.dataset.view));
    });
    for (const id of ["f-topic", "f-range", "f-engine"]) {
      $(id).addEventListener("change", renderOverview);
    }
    $("rec-search").addEventListener("input", renderRecords);
    $("rec-csv").addEventListener("click", exportCsv);
    $("rec-clear").addEventListener("click", async () => {
      if (!confirm("Delete all captured records? This cannot be undone.")) return;
      await S.clearRecords();
      records = [];
      renderAll();
    });
    $("s-save").addEventListener("click", saveSettingsForm);
    $("profile-go").addEventListener("click", profileMyPage);

    // permission controls
    await refreshPermissionUi();
    for (const id of ["perm-enable", "perm-enable-2"]) {
      const b = $(id);
      if (b) b.addEventListener("click", requestAnalysisPermission);
    }
    $("perm-revoke").addEventListener("click", async () => {
      try {
        await chrome.permissions.remove({ origins: BROAD_ORIGINS });
      } catch (e) {
        /* ignore */
      }
      await refreshPermissionUi();
    });
    $("cmp-winner").addEventListener("change", renderCompare);
    $("cmp-mine").addEventListener("change", renderCompare);

    // live refresh when new captures/profiles arrive while the tab is open
    chrome.storage.onChanged.addListener(async (changes, area) => {
      if (area !== "local") return;
      if (changes.answershare_records) {
        records = await S.getRecords();
        renderOverview();
        renderRecords();
      }
      if (changes.answershare_profiles) {
        profiles = await S.getProfiles();
        renderWinLoss();
      }
    });
  }

  init();
})();
