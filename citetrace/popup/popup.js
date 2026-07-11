/**
 * CiteTrace popup — trace history, aggregate stats, CSV export, per-site
 * toggles. Reads chrome.storage.local via shared/storage.js.
 */
(() => {
  const NS = globalThis.CiteTrace;
  const $ = (id) => document.getElementById(id);

  let history = [];
  let filterText = "";

  function fmtDate(iso) {
    try {
      const d = new Date(iso);
      return (
        d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) +
        " " +
        d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
      );
    } catch (e) {
      return iso || "";
    }
  }

  function filtered() {
    if (!filterText) return history;
    const q = filterText.toLowerCase();
    return history.filter(
      (h) =>
        (h.sourceDomain || "").toLowerCase().includes(q) ||
        (h.sourceUrl || "").toLowerCase().includes(q)
    );
  }

  function avg(nums) {
    if (nums.length === 0) return null;
    return nums.reduce((a, b) => a + b, 0) / nums.length;
  }

  function renderStats() {
    const rows = filtered();
    $("stat-total").textContent = String(rows.length);
    const cov = avg(rows.map((r) => r.coveragePct || 0));
    const v = avg(rows.map((r) => r.verbatimCount || 0));
    const p = avg(rows.map((r) => r.paraphraseCount || 0));
    $("stat-coverage").textContent = cov == null ? "–" : Math.round(cov) + "%";
    $("stat-verbatim").textContent = v == null ? "–" : v.toFixed(1);
    $("stat-paraphrase").textContent = p == null ? "–" : p.toFixed(1);

    // "your traced sources: avg 23% verbatim" — verbatim share of matched sentences
    const shares = rows
      .map((r) => {
        const total = (r.verbatimCount || 0) + (r.paraphraseCount || 0);
        return total > 0 ? (r.verbatimCount / total) * 100 : null;
      })
      .filter((x) => x != null);
    const share = avg(shares);
    $("agg-line").textContent =
      share == null
        ? ""
        : "your traced sources: avg " + Math.round(share) + "% verbatim (of matched sentences)";
  }

  function renderTable() {
    const body = $("history-body");
    body.textContent = "";
    const rows = filtered().slice().reverse(); // newest first
    $("empty").hidden = rows.length > 0;
    for (const r of rows) {
      const tr = document.createElement("tr");
      tr.title = r.sourceUrl;
      const cells = [
        ["date", fmtDate(r.date)],
        ["ai", r.aiSite || ""],
        ["domain", r.sourceDomain || r.sourceUrl || ""],
        ["num v", String(r.verbatimCount ?? 0)],
        ["num", String(r.paraphraseCount ?? 0)],
        ["num", (r.coveragePct ?? 0) + "%"],
      ];
      for (const [cls, text] of cells) {
        const td = document.createElement("td");
        td.className = cls;
        td.textContent = text;
        tr.appendChild(td);
      }
      tr.addEventListener("click", () => {
        if (r.sourceUrl) chrome.tabs.create({ url: r.sourceUrl });
      });
      body.appendChild(tr);
    }
  }

  function render() {
    renderStats();
    renderTable();
  }

  function csvEscape(v) {
    const s = String(v == null ? "" : v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function exportCsv() {
    const header = [
      "date", "ai_site", "source_url", "source_domain",
      "verbatim_count", "paraphrase_count", "coverage_pct",
    ];
    const lines = [header.join(",")];
    for (const r of filtered()) {
      lines.push(
        [
          r.date, r.aiSite, r.sourceUrl, r.sourceDomain,
          r.verbatimCount, r.paraphraseCount, r.coveragePct,
        ]
          .map(csvEscape)
          .join(",")
      );
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "citetrace-history-" + Date.now() + ".csv";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  async function init() {
    history = await NS.Storage.getHistory();
    render();

    $("filter").addEventListener("input", (e) => {
      filterText = e.target.value.trim();
      render();
    });

    $("export-csv").addEventListener("click", exportCsv);

    $("clear-all").addEventListener("click", async () => {
      if (!confirm("Delete all CiteTrace history? This cannot be undone.")) return;
      await NS.Storage.clearHistory();
      history = [];
      render();
    });

    const settings = await NS.Storage.getSettings();
    const toggles = [
      ["toggle-chatgpt", "enableChatgpt"],
      ["toggle-perplexity", "enablePerplexity"],
      ["toggle-gemini", "enableGemini"],
    ];
    for (const [id, key] of toggles) {
      const box = $(id);
      box.checked = settings[key] !== false;
      box.addEventListener("change", () => {
        NS.Storage.setSettings({ [key]: box.checked });
      });
    }
  }

  init();
})();
