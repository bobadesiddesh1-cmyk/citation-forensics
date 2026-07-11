/**
 * AnswerShare forensics orchestrator — runs ONLY when sentinel.js found a
 * #answershare= fragment (NS.pendingASJobId). Two job modes:
 *
 *   trace   — match the AI answer against this page (why-they-won view),
 *             then auto-save a WINNER profile (citability stats of the
 *             passages the AI actually used) for the dashboard's Win/Loss.
 *   profile — no answer involved: compute THIS page's structural profile
 *             (usually your own page) and save it as a MINE profile.
 */
(() => {
  const NS = (globalThis.CiteTrace = globalThis.CiteTrace || {});
  if (!NS.pendingASJobId || NS.__asMainStarted) return;
  NS.__asMainStarted = true;

  const EXTRACT_RETRIES_MS = [0, 1500, 3000, 5000];

  function whenDomReady() {
    return new Promise((resolve) => {
      if (document.readyState === "interactive" || document.readyState === "complete") {
        resolve();
      } else {
        document.addEventListener("DOMContentLoaded", () => resolve(), { once: true });
      }
    });
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function extractWithRetries() {
    let last = null;
    for (let i = 0; i < EXTRACT_RETRIES_MS.length; i++) {
      if (EXTRACT_RETRIES_MS[i] > 0) await sleep(EXTRACT_RETRIES_MS[i]);
      try {
        last = NS.Extract.extract(document);
        if (last.ok) return last;
      } catch (e) {
        /* retry */
      }
    }
    return last;
  }

  function onClear() {
    try {
      NS.Highlighter.clear();
    } catch (e) {
      /* silent */
    }
  }

  function newId() {
    const bytes = new Uint8Array(8);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  }

  function pageDomain() {
    return location.hostname.replace(/^www\./, "");
  }

  /** Whole-page structural profile (profile mode — "my page"). */
  function computePageStats(extraction) {
    const T = NS.Tokenizer;
    const sentences = T.splitSentences(extraction.text);
    const words = sentences.map((s) => T.tokenize(s.text).length);
    const avgWords =
      words.length > 0
        ? Math.round((words.reduce((a, b) => a + b, 0) / words.length) * 10) / 10
        : 0;
    const inRanges = (start, end, ranges) =>
      (ranges || []).some(([a, b]) => start < b && end > a);
    const followsHeading = (start) =>
      (extraction.meta.headingEnds || []).some((he) => start >= he && start - he <= 8);
    const pct = (n, d) => (d > 0 ? Math.round((n / d) * 100) : 0);
    return {
      sentenceCount: sentences.length,
      avgWords,
      numberPct: pct(sentences.filter((s) => /\d/.test(s.text)).length, sentences.length),
      listPct: pct(
        sentences.filter((s) => inRanges(s.start, s.end, extraction.meta.liRanges)).length,
        sentences.length
      ),
      headingPct: pct(sentences.filter((s) => followsHeading(s.start)).length, sentences.length),
      textLen: extraction.text.length,
    };
  }

  async function run() {
    try {
      const job = await NS.ASStorage.getJob(NS.pendingASJobId);
      if (!job) return; // session evicted — silent no-op

      await whenDomReady();
      const extraction = await extractWithRetries();

      if (!extraction || !extraction.ok) {
        NS.Panel.mountError({
          job,
          onClear,
          message:
            "Couldn't read enough of this page to analyze (paywall or heavy JS). " +
            "AnswerShare needs the article text to be present in the page.",
        });
        return;
      }

      if (job.mode === "profile") {
        const pageStats = computePageStats(extraction);
        await NS.ASStorage.addProfile({
          id: newId(),
          ts: Date.now(),
          kind: "mine",
          url: job.sourceUrl || location.href.split("#")[0],
          domain: pageDomain(),
          query: job.query || "",
          stats: pageStats,
        });
        NS.Panel.mountProfile({ job, pageStats, onClear });
        await NS.ASStorage.deleteJob(job.jobId);
        return;
      }

      // ── trace mode ──
      const matchResult = NS.Matcher.match(job.sentences, { text: extraction.text });
      const citability = NS.Citability.analyze({
        sourceSentences: matchResult.sourceSentences,
        citedIndices: matchResult.citedSourceSentences,
        meta: extraction.meta,
        totalLen: extraction.text.length,
      });

      NS.Highlighter.apply(extraction, matchResult.highlights, (info, rect) => {
        NS.Panel.showMatchCard(info, rect);
      });

      // auto-save the WINNER profile for the dashboard's Win/Loss view
      let profileSaved = false;
      if (citability.stats.citedCount > 0) {
        await NS.ASStorage.addProfile({
          id: newId(),
          ts: Date.now(),
          kind: "winner",
          url: job.sourceUrl || location.href.split("#")[0],
          domain: job.sourceDomain || pageDomain(),
          query: job.query || "",
          stats: {
            ...citability.stats,
            coveragePct: matchResult.coverage.pct,
          },
        });
        profileSaved = true;
      }

      NS.Panel.mount({ job, matchResult, citability, profileSaved, onClear });
      await NS.ASStorage.deleteJob(job.jobId);
    } catch (e) {
      /* forensics failure must never break the source page */
    }
  }

  run();
})();
