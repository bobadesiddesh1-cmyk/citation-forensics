/**
 * CiteTrace sentinel — the ONLY code that executes on every page.
 *
 * It performs a single string check on location.hash (< 1 ms) and exits
 * immediately when no #citetrace= fragment is present. The other files in
 * the <all_urls> bundle merely define functions inside an IIFE — they touch
 * neither the DOM nor the network unless this sentinel found a job.
 * (Full justification for <all_urls> lives in README.md.)
 */
(() => {
  try {
    const h = location.hash;
    if (!h || h.lastIndexOf("#citetrace=", 0) !== 0) return; // fast exit

    const NS = (globalThis.CiteTrace = globalThis.CiteTrace || {});
    NS.pendingJobId = decodeURIComponent(h.slice("#citetrace=".length));

    // Strip the fragment from the URL bar immediately so reloads/bookmarks
    // are clean and the page's own hash-routing never sees it.
    try {
      history.replaceState(null, "", location.pathname + location.search);
    } catch (e) {
      /* sandboxed page — the trace still runs, the URL just stays ugly */
    }
  } catch (e) {
    /* never interfere with the host page */
  }
})();
