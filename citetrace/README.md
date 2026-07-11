# CiteTrace — AI Citation Forensics

When ChatGPT, Perplexity, or Gemini cites a source, CiteTrace opens the
source and shows you **exactly which passages the AI actually used** —
verbatim lifts in red, paraphrases in orange — plus what the AI claimed that
the source never said. The fact-checking layer AI answers are missing.

**100% local text-matching engine. No API keys. No account. No network
requests. No analytics.**

For SEO/AEO professionals there's a bonus lens: the **Citability profile**
tab reverse-engineers *why* certain passages get cited (length, position,
number density, structure) so you can shape content the way AI engines like
to quote it.

---

## Install (load unpacked)

1. Clone or download this repository.
2. Open `chrome://extensions` in Chrome (or any Chromium browser).
3. Enable **Developer mode** (top-right toggle).
4. Click **Load unpacked** and select the `citetrace/` folder.
5. Done — no build step, no dependencies.

## How to use

1. Ask ChatGPT (with web search), Perplexity, or Gemini a question that
   produces cited sources.
2. When the answer finishes, a small **🔍 Trace** button appears next to
   each citation link/chip.
3. Click it. The source opens in a new tab and CiteTrace paints the page:
   - 🟥 **red** — passages the AI lifted nearly word-for-word
   - 🟧 **orange** — passages the AI paraphrased
4. The side panel shows the answer-sentence ↔ source-passage pairs
   (**Matches**), everything the AI said that *this* page doesn't support
   (**Not found here**, incl. unverified figures), and the SEO analysis
   (**Citability**).
5. Click any highlight for the matching answer sentence; click any match
   card to scroll to its highlight. **⬇ Export report** downloads a
   standalone HTML forensics report. **✕ clear** restores the page DOM
   byte-exact.
6. The toolbar popup keeps your last 200 traces with aggregate stats,
   domain filtering, CSV export and per-site on/off toggles.

---

## Matching methodology

The engine (`content/matcher.js`) is pure, deterministic and local. Answer
text is pre-split into sentences on the chat page; the source page's main
content is extracted (`<article>` → `<main>` → largest text block, minus
nav/footer/asides/scripts) and compared:

| Check | Rule | Result |
|---|---|---|
| **Verbatim** | contiguous run of **≥ 8** normalized words shared with the source (source 8-grams live in a hash set; the answer sentence slides a window over it, runs extend maximally) | red highlight |
| **Verbatim (short)** | exact run of **5–7** words **if** the run contains a number or a proper noun (capitalized token in the original answer, not sentence-initial) | red highlight |
| **Paraphrase** | vs each source sentence: token-set Jaccard **≥ 0.55**, **or** Jaccard **≥ 0.40 and ≥ 3 shared rare tokens** (rare = not in the shipped 200-word stoplist); best-scoring source sentence wins | orange highlight |
| **Figures** | every number / % / currency amount in the answer must appear in the source text — exact string match after removing commas only | "unverified figures" list |
| **Unsupported** | answer sentence with no verbatim and no paraphrase match | "Not found in THIS source" list |

Normalization: lowercase, collapsed whitespace, punctuation stripped except
decimal points, commas removed inside numbers ("1,500" ≡ "1500").

Overlaps: verbatim beats paraphrase; paraphrase ranges are clipped around
verbatim ones. Coverage = union of matched character ranges ÷ extracted
text length.

Performance: a 20,000-word source vs 60 answer sentences completes in
~130 ms on commodity hardware (budget: 800 ms) — n-grams are hash-indexed,
token sets precomputed, paraphrase candidates pre-filtered through an
inverted index.

### Framing matters

A sentence in "Not found here" is **not** flagged as false — it simply has
no support in *this* source. AI answers routinely blend multiple citations;
trace the other ones. Likewise the matcher verifies *text reuse*, not truth.

---

## Why `<all_urls>`?

The forensics side must run on **whatever page an AI cites** — that's the
entire product. There is no predictable host list for "everything on the
web an AI might cite."

What actually happens on unrelated pages: `content/sentinel.js` performs a
single string comparison on `location.hash` (`#citetrace=` prefix check,
< 1 ms) and returns. The other files in the bundle only *define* functions
(pure IIFEs — no DOM access, no listeners, no timers at load). No page
content is read, nothing is stored, nothing is transmitted — on any page,
ever, until you click Trace and land on that exact tab with a live job ID.

Permissions requested: `storage`, `tabs`. Nothing else. The extension has
no `host_permissions` for fetching — it *cannot* make network requests for
page content; your browser opens the source tab like any normal navigation.

## Privacy posture

- Zero network requests, zero analytics, zero remote config.
- Trace jobs live in `chrome.storage.session` (gone when the browser
  closes); history keeps only aggregates (date, site, URL, domain, match
  counts, coverage %) — never page text or answer text — capped at 200
  entries, oldest evicted first.
- Everything renders in Shadow DOM and is removed byte-exact on Clear.

---

## Limitations (honest list)

- **Figure matching is literal.** "1.5 million" ≠ "1,500,000"; spelled-out
  numbers, unit conversions and rounded figures are not equated. A figure
  marked "unverified" may still be present in another form.
- **Paywalled / heavy-JS pages:** if under 300 characters of main text are
  extractable (after retries up to ~9.5 s), CiteTrace shows an honest
  failure state instead of pretending to verify.
- **PDF citations** aren't traceable yet — the Trace click shows a toast
  and does not open a tab.
- **Opaque redirect citations** (e.g. some Gemini grounding links) can't be
  unwrapped locally; the trace fragment usually survives the HTTP redirect,
  but JS redirects drop it and the trace silently won't run.
- **Adapters track live DOMs** of three fast-moving products. Each ships
  2–3 fallback selector strategies and fails silent, but a redesign can
  temporarily break capture on a site until selectors are updated.
- **Lexical matching only.** A heavy semantic rewrite with different
  vocabulary can slip below the paraphrase thresholds; a common idiom can
  exceed them. Treat tiers as evidence, not verdicts.
- Quotes the AI *attributed* to this source are matched against this source
  only — CiteTrace doesn't decide which of several citations "owns" a
  sentence.

---

## Acceptance tests (walkthrough)

1. **Clean load** — Load unpacked → open chatgpt.com, perplexity.ai,
   gemini.google.com and any arbitrary page → DevTools console shows zero
   errors from the extension on all of them.
2. **Trace buttons** — Ask Perplexity a webby question ("what did the James
   Webb telescope find this year?") → after the answer settles (~1 s),
   🔍 Trace chips appear beside citation chips.
3. **Forensics render** — Click Trace → source tab opens, `#citetrace=` is
   stripped from the URL bar, red/orange highlights paint, panel lists
   matches with VERBATIM/PARAPHRASE badges; clicking a match card scrolls
   to and pulses its highlight; clicking a highlight pops the matching
   answer sentence.
4. **Not-found framing** — An answer sentence absent from the source shows
   under "Not found (n)" with the "not found in THIS source" note, never
   "false".
5. **Citability** — Tab 3 renders the stat table (avg words cited vs
   uncited, position thirds, % with numbers, list/heading stats) plus 2–3
   template takeaway lines.
6. **Stats & history** — Coverage % in the panel header matches the history
   entry visible in the popup; CSV export contains the same row; aggregate
   stats update.
7. **Honest failures** — A paywalled article (e.g. FT/WSJ) yields the
   "Couldn't read enough of this page to trace (paywall or heavy JS)"
   state. A `.pdf` citation shows the "PDF tracing not supported yet" toast
   on the chat page and opens no tab.
8. **Byte-exact restore** — Run
   `document.body.innerHTML.length` before Trace and after ✕ clear on a
   static page: identical, because the original text nodes themselves are
   re-inserted (structural restore, see DECISIONS.md #14).

## Verifying the engine without a browser

The matcher, tokenizer, stoplist and citability modules are pure and run in
Node: they attach to `globalThis.CiteTrace`. Concatenate + eval the four
files and call `CiteTrace.Matcher.match([...sentences], {text})` — the
worked example in the header of `content/matcher.js` documents expected
tiers and thresholds.

---

## Chrome Web Store listing (draft)

**Name:** CiteTrace — AI Citation Forensics

**Summary (132 chars):** See exactly what ChatGPT, Perplexity & Gemini took
from their sources: verbatim lifts in red, paraphrases in orange. 100% local.

**Description:**

AI answers cite sources — but did the source actually say that?

CiteTrace adds a 🔍 Trace button next to every citation in ChatGPT,
Perplexity and Gemini. One click opens the source and paints it like a
forensic exhibit:

🟥 Red — passages the AI lifted nearly word-for-word
🟧 Orange — passages it paraphrased
🕳️ "Not found here" — claims this source never made, plus unverified
figures

You also get a coverage stat ("the AI used 23% of this page"), a full match
list, an exportable HTML report, and a trace history with CSV export.

For SEO & AEO professionals: the Citability tab reverse-engineers what the
cited passages have in common — sentence length, position in the document,
number density, list/heading structure — so you can build content AI
engines love to quote.

Private by design: CiteTrace is a pure text-matching engine that runs
entirely in your browser. No API keys, no account, no network requests, no
analytics. Ever.

**Category:** Productivity → Tools
**Language:** English

---

## File map

```
citetrace/
├── manifest.json              MV3 manifest
├── background.js              session-storage access level + tab opener
├── content/
│   ├── adapters/              per-site answer/citation extraction (2–3 fallbacks each)
│   │   ├── chatgpt.js
│   │   ├── perplexity.js
│   │   └── gemini.js
│   ├── capture.js             Trace buttons, job creation (AI chat pages)
│   ├── sentinel.js            <1 ms #citetrace= fragment check (<all_urls>)
│   ├── extract.js             main-content extraction w/ node-offset map
│   ├── matcher.js             n-gram + Jaccard engine (pure)
│   ├── citability.js          Tab-3 stats + template takeaways (pure)
│   ├── highlighter.js         non-destructive wrap + byte-exact restore registry
│   ├── panel.js               Shadow-DOM side panel, tabs, match cards
│   └── main.js                forensics orchestrator
├── shared/
│   ├── tokenizer.js           normalize / tokenize / sentence-split / figures (pure)
│   ├── stoplist.js            200 common English words (pure)
│   ├── storage.js             session jobs, history (cap 200 FIFO), settings
│   └── report.js              standalone HTML report builder + Blob download
├── popup/                     history table, stats, CSV export, toggles
├── icons/                     16/32/48/128 (generated, see DECISIONS.md #20)
├── DECISIONS.md               every judgment call, logged
└── README.md                  this file
```
