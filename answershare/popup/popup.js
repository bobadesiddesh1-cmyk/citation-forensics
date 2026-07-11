/**
 * AnswerShare popup — 30-day quick stats + dashboard launcher.
 */
(() => {
  const NS = globalThis.CiteTrace;
  const S = NS.ASStorage;
  const $ = (id) => document.getElementById(id);

  async function init() {
    const [records, settings] = await Promise.all([S.getRecords(), S.getSettings()]);
    const cutoff = Date.now() - 30 * 86400000;
    const recent = records.filter((r) => r.ts >= cutoff);
    const hasMine = (settings.myDomains || []).length > 0;

    $("stat-records").textContent = String(records.length);

    const myHit = (r) =>
      (r.citations || []).some((c) => S.matchesDomainList(c.domain, settings.myDomains));
    if (hasMine && recent.length > 0) {
      const cited = recent.filter(myHit).length;
      const share = Math.round((cited / recent.length) * 100);
      const el = $("stat-share");
      el.textContent = share + "%";
      el.classList.toggle("bad", share < 25);
      $("stat-losses").textContent = String(recent.length - cited);
    } else {
      $("stat-share").textContent = "–";
      $("stat-losses").textContent = "0";
    }

    const last = records[records.length - 1];
    $("latest").textContent = last
      ? `latest: “${(last.query || "(no query)").slice(0, 46)}” · ${last.aiSite} · ${
          (last.citations || []).length
        } citations`
      : hasMine
        ? "no captures yet — just use your AI tools normally"
        : "tip: set your domain in the dashboard settings";

    $("open-dashboard").addEventListener("click", () => {
      chrome.runtime.sendMessage({ type: "ANSWERSHARE_OPEN_DASHBOARD" }, () => window.close());
    });
  }

  init();
})();
