/**
 * CiteTrace forensics orchestrator — runs ONLY when sentinel.js found a
 * #citetrace= fragment on this page (NS.pendingJobId). Loads the trace job,
 * extracts main content (with retries for JS-rendered pages), runs the
 * matching engine, paints highlights, mounts the panel, records history.
 */
(() => {
  const NS = (globalThis.CiteTrace = globalThis.CiteTrace || {});
  if (!NS.pendingJobId || NS.__mainStarted) return;
  NS.__mainStarted = true;

  const EXTRACT_RETRIES_MS = [0, 1500, 3000, 5000]; // attempts for late-rendering pages

  function whenDomReady() {
    return new Promise((resolve) => {
      if (document.readyState === "interactive" || document.readyState === "complete") {
        resolve();
      } else {
        document.addEventListener("DOMContentLoaded", () => resolve(), { once: true });
      }
    });
  }

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

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

  async function run() {
    try {
      const job = await NS.Storage.getJob(NS.pendingJobId);
      if (!job) return; // session evicted / browser restarted — silent no-op

      await whenDomReady();
      const extraction = await extractWithRetries();

      if (!extraction || !extraction.ok) {
        NS.Panel.mountError({
          job,
          onClear,
          message:
            "Couldn't read enough of this page to trace (paywall or heavy JS). " +
            "CiteTrace needs the article text to be present in the page.",
        });
        return;
      }

      const matchResult = NS.Matcher.match(job.sentences, {
        text: extraction.text,
      });

      const citability = NS.Citability.analyze({
        sourceSentences: matchResult.sourceSentences,
        citedIndices: matchResult.citedSourceSentences,
        meta: extraction.meta,
        totalLen: extraction.text.length,
      });

      NS.Highlighter.apply(extraction, matchResult.highlights, (info, rect) => {
        NS.Panel.showMatchCard(info, rect);
      });

      NS.Panel.mount({ job, matchResult, citability, onClear });

      // record history (cap 200, FIFO)
      const verbatimCount = matchResult.sentences.filter(
        (s) => s.tier === "verbatim"
      ).length;
      const paraphraseCount = matchResult.sentences.filter(
        (s) => s.tier === "paraphrase"
      ).length;
      await NS.Storage.addHistory({
        date: new Date().toISOString(),
        aiSite: job.aiSite,
        sourceUrl: job.sourceUrl,
        sourceDomain: job.sourceDomain || location.hostname.replace(/^www\./, ""),
        verbatimCount,
        paraphraseCount,
        coveragePct: matchResult.coverage.pct,
      });

      // the job is one-shot; free the session slot
      await NS.Storage.deleteJob(job.jobId);
    } catch (e) {
      /* forensics failure must never break the source page */
    }
  }

  run();
})();
