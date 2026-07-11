/**
 * AnswerShare sentinel — the ONLY code that executes on every page.
 *
 * A single string check on location.hash (< 1 ms); exits immediately when
 * no #answershare= fragment is present. The other files in the <all_urls>
 * bundle merely define functions inside IIFEs — they touch neither the DOM
 * nor the network unless this sentinel found a job.
 * (Full justification for <all_urls> lives in README.md.)
 */
(() => {
  try {
    const h = location.hash;
    if (!h || h.lastIndexOf("#answershare=", 0) !== 0) return; // fast exit

    const NS = (globalThis.CiteTrace = globalThis.CiteTrace || {});
    NS.pendingASJobId = decodeURIComponent(h.slice("#answershare=".length));

    try {
      history.replaceState(null, "", location.pathname + location.search);
    } catch (e) {
      /* sandboxed page — the trace still runs, the URL just stays ugly */
    }
  } catch (e) {
    /* never interfere with the host page */
  }
})();
