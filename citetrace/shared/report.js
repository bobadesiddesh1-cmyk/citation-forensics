/**
 * CiteTrace report builder — generates a fully standalone HTML forensics
 * report (inline CSS, zero external resources) and downloads it via a Blob.
 * Pure string building; the only DOM use is the download anchor.
 */
(() => {
  const NS = (globalThis.CiteTrace = globalThis.CiteTrace || {});
  if (NS.Report) return;

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function tierBadge(tier) {
    if (tier === "verbatim") {
      return '<span class="badge badge-v">VERBATIM</span>';
    }
    if (tier === "paraphrase") {
      return '<span class="badge badge-p">PARAPHRASE</span>';
    }
    return '<span class="badge badge-n">NOT FOUND HERE</span>';
  }

  /**
   * buildHTML({ job, matchResult, citability }) -> standalone HTML string
   */
  function buildHTML({ job, matchResult, citability }) {
    const m = matchResult;
    const date = new Date().toLocaleString();
    const verbatimCount = m.sentences.filter((s) => s.tier === "verbatim").length;
    const paraphraseCount = m.sentences.filter((s) => s.tier === "paraphrase").length;

    const matchRows = m.sentences
      .filter((s) => s.tier !== "none")
      .map((s) => {
        const excerpts = s.verbatimRuns
          .map(
            (r) =>
              `<div class="excerpt excerpt-v">“${esc(r.text)}” <span class="meta">(${r.words}-word run)</span></div>`
          )
          .join("");
        const para = s.paraphrase
          ? `<div class="excerpt excerpt-p">“${esc(s.paraphrase.sourceText)}” <span class="meta">(similarity ${Math.round(
              s.paraphrase.similarity * 100
            )}%)</span></div>`
          : "";
        return `<div class="pair">
          ${tierBadge(s.tier)}
          <div class="answer">AI answer: ${esc(s.text)}</div>
          <div class="source-label">Matched source passage${
            s.verbatimRuns.length + (s.paraphrase ? 1 : 0) > 1 ? "s" : ""
          }:</div>
          ${excerpts}${para}
        </div>`;
      })
      .join("");

    const notFoundRows = m.notFound
      .map(
        (i) =>
          `<div class="pair">${tierBadge("none")}<div class="answer">${esc(
            m.sentences[i].text
          )}</div></div>`
      )
      .join("");

    const figures = m.figures.unverified
      .map(
        (f) =>
          `<li><strong>${esc(f.raw)}</strong> — from: “${esc(
            m.sentences[f.sentenceIndex] ? m.sentences[f.sentenceIndex].text : ""
          )}”</li>`
      )
      .join("");

    const cs = citability ? citability.stats : null;
    const citabilityBlock = cs
      ? `<h2>Citability profile</h2>
        <table class="stats">
          <tr><td>Source sentences cited</td><td>${cs.citedCount} of ${
            cs.citedCount + cs.uncitedCount
          }</td></tr>
          <tr><td>Avg words — cited vs uncited</td><td>${cs.avgWordsCited} vs ${cs.avgWordsUncited}</td></tr>
          <tr><td>Cited passage position (first / middle / last third)</td><td>${cs.positionPct.first}% / ${cs.positionPct.middle}% / ${cs.positionPct.last}%</td></tr>
          <tr><td>Cited sentences containing a number</td><td>${cs.numberPctCited}% (uncited: ${cs.numberPctUncited}%)</td></tr>
          <tr><td>Cited sentences inside list items</td><td>${cs.listPctCited}%</td></tr>
          <tr><td>Cited sentences directly after a heading</td><td>${cs.headingPctCited}%</td></tr>
        </table>
        <ul class="takeaways">${citability.takeaways
          .map((t) => `<li>${esc(t)}</li>`)
          .join("")}</ul>`
      : "";

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>CiteTrace report — ${esc(job.sourceDomain || job.sourceUrl)}</title>
<style>
  :root { color-scheme: light dark; }
  body { font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
         margin: 0; padding: 2rem; background: #0d1b26; color: #dbe7ee; line-height: 1.55; }
  .wrap { max-width: 860px; margin: 0 auto; }
  h1 { font-size: 1.4rem; letter-spacing: 0.02em; }
  h1 .brand { color: #35d0ba; }
  h2 { font-size: 1.05rem; margin-top: 2.2rem; border-bottom: 1px solid #24455a;
       padding-bottom: 0.4rem; text-transform: uppercase; letter-spacing: 0.08em;
       font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace; color: #7fb3c8; }
  a { color: #35d0ba; }
  .meta-line { color: #7fb3c8; font-size: 0.85rem; }
  .kpis { display: flex; gap: 1rem; flex-wrap: wrap; margin: 1.4rem 0; }
  .kpi { background: #13293a; border: 1px solid #24455a; border-radius: 10px;
         padding: 0.8rem 1.1rem; min-width: 130px; }
  .kpi b { display: block; font-size: 1.5rem; font-family: ui-monospace, Menlo, monospace; }
  .kpi span { font-size: 0.75rem; color: #7fb3c8; text-transform: uppercase; letter-spacing: 0.06em; }
  .pair { background: #13293a; border: 1px solid #24455a; border-radius: 10px;
          padding: 1rem 1.2rem; margin: 0.8rem 0; }
  .answer { margin: 0.5rem 0; }
  .source-label { font-size: 0.75rem; color: #7fb3c8; text-transform: uppercase;
                  letter-spacing: 0.06em; margin-top: 0.6rem; }
  .excerpt { margin: 0.45rem 0; padding: 0.55rem 0.8rem; border-radius: 6px; font-size: 0.92rem; }
  .excerpt-v { background: rgba(239,68,68,0.16); border-left: 3px solid #EF4444; }
  .excerpt-p { background: rgba(249,115,22,0.14); border-left: 3px solid #F97316; }
  .meta { color: #7fb3c8; font-size: 0.8rem; }
  .badge { font-size: 0.68rem; font-weight: 700; letter-spacing: 0.08em; padding: 0.2rem 0.55rem;
           border-radius: 999px; font-family: ui-monospace, Menlo, monospace; }
  .badge-v { background: rgba(239,68,68,0.2); color: #ff8b8b; border: 1px solid #EF4444; }
  .badge-p { background: rgba(249,115,22,0.18); color: #ffb27a; border: 1px solid #F97316; }
  .badge-n { background: rgba(127,179,200,0.15); color: #9fc9dc; border: 1px solid #46718a; }
  table.stats { border-collapse: collapse; width: 100%; }
  table.stats td { border: 1px solid #24455a; padding: 0.5rem 0.8rem; font-size: 0.92rem; }
  .takeaways li { margin: 0.5rem 0; }
  .disclaimer { margin-top: 2.5rem; padding: 1rem; border: 1px dashed #46718a; border-radius: 10px;
                font-size: 0.85rem; color: #9fc9dc; }
  @media print { body { background: #fff; color: #111; } }
</style>
</head>
<body><div class="wrap">
  <h1><span class="brand">Cite</span>Trace forensics report</h1>
  <p class="meta-line">
    Source: <a href="${esc(job.sourceUrl)}">${esc(job.sourceUrl)}</a><br>
    Traced from: ${esc(job.aiSite || "unknown AI site")} · Generated: ${esc(date)}
  </p>
  <div class="kpis">
    <div class="kpi"><b>${verbatimCount}</b><span>verbatim sentences</span></div>
    <div class="kpi"><b>${paraphraseCount}</b><span>paraphrased sentences</span></div>
    <div class="kpi"><b>${m.notFound.length}</b><span>not found here</span></div>
    <div class="kpi"><b>${m.coverage.pct}%</b><span>of page used</span></div>
  </div>

  <h2>Matches</h2>
  ${matchRows || "<p>No verbatim or paraphrase matches were found in this source.</p>"}

  <h2>Not found in this source</h2>
  <p class="meta-line">These answer sentences had no match in THIS source. They may be
  supported by the AI's other citations — absence here does not mean they are false.</p>
  ${notFoundRows || "<p>Every answer sentence matched this source.</p>"}
  ${
    figures
      ? `<h3>Unverified figures</h3><p class="meta-line">Numbers in the answer that do not appear in this source's text (exact match after comma removal):</p><ul>${figures}</ul>`
      : ""
  }

  ${citabilityBlock}

  <div class="disclaimer">
    Generated locally by the CiteTrace browser extension. Matching is purely
    lexical (n-gram + Jaccard similarity) — it verifies text reuse, not truth.
    CiteTrace performs no network requests and sends data nowhere.
  </div>
</div></body></html>`;
  }

  /** Build the report and trigger a Blob download. */
  function download(data) {
    try {
      const html = buildHTML(data);
      const blob = new Blob([html], { type: "text/html" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const domain = (data.job.sourceDomain || "source").replace(/[^\w.-]/g, "_");
      a.href = url;
      a.download = `citetrace-report-${domain}-${Date.now()}.html`;
      document.documentElement.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      return true;
    } catch (e) {
      return false;
    }
  }

  NS.Report = { buildHTML, download };
})();
