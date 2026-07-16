# AnswerShare — AI Share-of-Voice

A **rank tracker for AI answers**. AnswerShare silently logs which domains
ChatGPT, Perplexity and Gemini cite for the questions you ask, then shows
you the market: your citation share vs competitors, the exact queries you're
losing, and — via the built-in forensics engine — *why* the winning passage
won, so you can restructure your content to take the citation.

**100% local. No API keys. No account. No network requests. No analytics.**

Built on the same local text-forensics engine as its sibling extension
CiteTrace (`../citetrace/`): n-gram verbatim matching, Jaccard paraphrase
detection, and structural citability profiling.

---

## Install (load unpacked)

1. Open `chrome://extensions`, enable **Developer mode**.
2. **Load unpacked** → select the `answershare/` folder.
3. Click the toolbar icon → **Open dashboard** → Settings → enter **your
   domain(s)** (and optionally competitors + topics). That's the whole setup.

## How it works

### 1. Passive capture — just use your AI tools

Whenever an answer with citations finishes on chatgpt.com, perplexity.ai or
gemini.google.com, AnswerShare records locally:

- the **query** you asked,
- the **citation list** (domain, URL, rank order),
- the answer text (kept so you can run the why-they-won trace later).

A small toast tells you the outcome instantly: *"your domain cited #2 🎉"*
or *"your domain NOT cited (5 sources)"*. Records are deduplicated
(same site + query + citation set) and capped at 2,000, oldest evicted.

### 2. The dashboard — share of voice

Open it from the popup. Filter by topic / time range / engine, and see:

- **KPIs** — tracked queries, your citation share, top competitor share, losses
- **Weekly trend** of your share (last 8 weeks)
- **Domain leaderboard** — % of tracked queries where each domain was cited
  (your domains highlighted teal, declared competitors amber)
- **Loss list** — every query where a competitor was cited and you weren't,
  each with **ANALYZE WHY →**
- **Records** — every capture, searchable, CSV-exportable

### 3. Analyze why — the win/loss autopsy

"ANALYZE WHY →" (or the 🔎 Why? button next to any citation in the chat)
opens the winning page and runs the forensics engine:

- **Why cited** tab — the citability profile of the passages the AI actually
  used: length, number density, position in the document, list/heading
  structure, plus takeaway lines. This profile is **auto-saved as a WINNER
  profile**.
- **Matches / Not found** tabs — the full verbatim (red) / paraphrase
  (orange) evidence, byte-exact restorable.

Then, on the dashboard's **Win/Loss** view, profile one of your own pages
(enter its URL → it opens and its structure is captured as a **MINE**
profile) and compare the two side by side. The gap report is deterministic:
avg words, % with numbers, % under headings, % in lists, position — with
concrete fix instructions ("their cited passages average 14 words; your
sentences average 41 — tighten").

## Permissions & privacy

- Manifest permissions: `storage`, `scripting` — no broad host
  access is requested up front. The only declared content-script hosts are
  the three AI sites (chatgpt.com, perplexity.ai, gemini.google.com), so
  passive capture works immediately and the extension's default footprint is
  narrow.
- **Page analysis is an optional, on-demand permission.** The win/loss
  autopsy needs to open and read cited pages / your own pages, which can be
  any site — so instead of requesting `<all_urls>` in the manifest,
  AnswerShare asks Chrome for that access **once**, when you first click
  "Enable page analysis" (or Analyze why / Profile it) in the dashboard.
  On grant, the forensics bundle is registered dynamically via
  `chrome.scripting.registerContentScripts`; you can revoke it any time from
  the dashboard or `chrome://extensions`. The inline 🔎 Why? button on the
  AI pages checks this grant and, if it's missing, opens the dashboard so you
  can enable it in one click.
- Even with page analysis enabled, the injected script runs a `< 1 ms`
  `#answershare=` fragment check and exits on any page you didn't explicitly
  send it to (fragment-gated sentinel).
- Zero host permissions for *fetching*; the extension **cannot** make
  network requests for page content and makes no network requests at all.
- Your queries and answers are yours: stored **only** in
  `chrome.storage.local` in your browser, capped, clearable in one click,
  never transmitted anywhere.

## Honest limitations

- **It can't run queries for you.** Auto-driving ChatGPT/Perplexity would
  breach their terms and risk your accounts. AnswerShare harvests your
  natural usage; for systematic tracking, run your target query list
  manually once a week — capture is automatic once the answers render.
- **Query capture is DOM-based.** If a site redesign hides the prompt text,
  records may show "(query not captured)" until adapters are updated;
  citations still log.
- Data is per-browser (no sync/team features in v1).
- Same lexical-matching caveats as CiteTrace: the trace verifies text
  reuse, not truth; paywalled/JS-blocked winner pages show an honest
  failure state; PDFs aren't traceable yet.

## File map

```
answershare/
├── manifest.json
├── background.js              session access level + tab/job opener
├── content/
│   ├── adapters/              per-site query+answer+citation extraction
│   ├── capture.js             passive logging + 🔎 Why? buttons
│   ├── sentinel.js            <1 ms #answershare= fragment check
│   ├── extract.js  matcher.js  citability.js  highlighter.js   (shared engine)
│   ├── panel.js               Why cited / Matches / Not found + profile mode
│   └── main.js                trace + profile orchestrator
├── shared/                    tokenizer, stoplist, storage, report
├── dashboard/                 share of voice, win/loss compare, records, settings
├── popup/                     quick stats + dashboard launcher
└── icons/                     radar motif (generated, no binary assets)
```
