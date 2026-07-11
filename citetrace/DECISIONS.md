# CiteTrace — Decision Log

Decisions made where the spec left room for interpretation. Everything here
was chosen to keep the extension local-only, framework-free and unbreakable
on host pages.

## Architecture

1. **How the `<all_urls>` forensics bundle stays "lightweight".**
   MV3 offers no way for a tiny sentinel to lazily inject sibling content
   scripts without the `scripting` permission (which the spec forbids —
   permissions are locked to `storage` + `tabs`). So the whole forensics
   bundle is listed in the manifest, but every file is an inert IIFE that
   only *defines* functions on `globalThis.CiteTrace`. The only code that
   *executes* on an ordinary page is sentinel.js's single
   `location.hash.lastIndexOf("#citetrace=", 0)` check (< 1 ms), after which
   `main.js`'s guard (`if (!NS.pendingJobId) return`) exits immediately.
   Cost on unrelated pages: JS parse only, zero DOM reads, zero listeners.

2. **`background.js` exists (spec's build step 9 anticipated this).**
   Two reasons: (a) `chrome.storage.session.setAccessLevel("TRUSTED_AND_
   UNTRUSTED_CONTEXTS")` must be called from a trusted context or content
   scripts cannot read trace jobs on the source page; (b) content scripts
   cannot call `chrome.tabs.create`, so the capture script messages the
   worker to open the source tab. The worker writes the job to
   `storage.session` *before* creating the tab, so the sentinel can never
   race an unwritten job.

3. **`run_at: document_end` for the forensics bundle** (not `document_idle`)
   so the sentinel reads `location.hash` before most SPA routers normalize
   the URL. Late-rendering pages are handled by extraction retries in
   `main.js` (attempts at 0 / 1.5 / 3 / 5 s before showing the honest
   "couldn't read this page" state).

4. **Adapter contract extension: `citations[].el`.** The spec's shape is
   `{url, title?, marker?}`; adapters additionally return the citation's DOM
   node so capture.js knows where to inject the Trace button. Pure data
   consumers (the matcher, storage) never see `el`.

5. **Existing URL fragments are replaced.** `https://site.com/page#section`
   becomes `…/page#citetrace=<id>`, so the source page loses its anchor
   scroll position for that one visit. Chosen over query-param smuggling
   (which would poison caches/analytics and can change server responses).

6. **Opaque redirect citations (Gemini's `vertexsearch.cloud.google.com/
   grounding-api-redirect/…`)** cannot be unwrapped locally — the target is
   not in the URL. We open them as-is: browsers propagate a URL fragment
   across HTTP redirects when the `Location` header carries none, so the
   trace usually survives. JS-based redirects drop it → the trace silently
   doesn't run (fail-safe, not fail-broken). Transparent redirect wrappers
   (`google.com/url?q=…`, `?url=`, `?u=` etc.) are unwrapped.

## Matching engine

7. **Jaccard is computed over full normalized token sets** (stopwords
   included), exactly as "token-set Jaccard" reads. The stoplist is only
   used for (a) the shared-rare-token count in the 0.40-tier and (b) the
   paraphrase candidate pre-filter (inverted index over non-stopwords).

8. **Sentences shorter than 5 tokens skip the paraphrase tier.** Jaccard on
   3-token sets is noise ("It is true." would match half the web). They can
   still match verbatim via the 5-gram rule and still appear in "Not found
   here" otherwise.

9. **Proper-noun rule for 5–7-word verbatim runs:** a capitalized token
   counts only if it is NOT the sentence's first token (sentence-initial
   capitalization proves nothing). Numbers qualify anywhere in the window.

10. **Figure matching is exact-string after comma removal only** (per spec).
    Logged limitations: "1.5 million" ≠ "1,500,000"; "45 %" in the *source*
    with the space is missed ("45 %" in the *answer* is normalized); spelled
    -out numbers and unit conversions are invisible. Additionally, **bare
    single digits (1–9) are never checked** — they appear on virtually every
    page and would make "verified" meaningless.

11. **Overlap resolution:** verbatim highlights always win; paraphrase
    ranges are clipped against them and slivers under 3 chars are dropped.
    Same-tier overlaps are merged per text node at paint time.

12. **Coverage stat** = union of matched source char ranges ÷ total
    extracted chars, shown as "~X%" because extraction (not the raw HTML)
    is the denominator.

## Extraction & highlighting

13. **Hidden-content detection is attribute-based** (`hidden`,
    `aria-hidden="true"`, inline `display:none/visibility:hidden`), not
    `getComputedStyle` per element — computed style on a 20k-word page costs
    more than the entire matching run. Off-screen-but-visible-to-DOM text
    may therefore be extracted; acceptable for text forensics.

14. **Byte-exact restore is structural, not string-based:** the original
    text nodes are never mutated — they are parked in a registry and the
    painted replacements are removed on Clear, re-inserting the identical
    node objects. Restoration cannot drift because nothing was copied.

15. **`<figure>` (incl. captions) is skipped during extraction** along with
    nav/footer/aside/forms — captions repeat body text often enough to
    produce double-highlights.

## Product

16. **History records aggregates only** (date, site, URL, domain, counts,
    coverage) — never the answer text or the page text. Keeps
    `storage.local` small and the privacy story simple.

17. **Trace jobs are one-shot:** deleted from `storage.session` after a
    successful render. A reload of the source tab shows the clean page
    (the fragment was already stripped), which matches the "non-destructive
    overlay" mental model.

18. **Popup aggregate "avg X% verbatim"** = mean over traces of
    verbatim ÷ (verbatim + paraphrase) matched sentences, i.e. "of what was
    matched, how much was lifted word-for-word" — the most honest reading of
    the spec's example stat.

19. **UI theme:** "forensic lab" — deep harbor-navy surfaces, teal
    (#14B8A6/#35D0BA) accents, monospace labels, red/orange reserved
    exclusively for the two evidence tiers. Dark-mode aware via
    `prefers-color-scheme` (dark is the native look; light is a pale slate
    variant). Deliberately not the default look of any AI assistant.

20. **Icons** are generated programmatically (pure-Python PNG writer, no
    binary assets of unknown provenance): navy rounded square, teal
    magnifier, red dot — the "spot the lifted passage" motif.

21. **Perplexity answer-body links:** when an answer container has real
    citation chips, plain external links inside the prose are ignored
    (they're part of the text, not citations). When no chips exist,
    external links are treated as citations (fallback strategy).

22. **Streaming detection** is adapter-specific (streaming classes / visible
    Stop button) layered under a generic guard: the MutationObserver
    debounce (1 s of DOM silence) means we only ever scan settled messages.
