/**
 * CiteTrace matching engine — pure functions, no DOM, no chrome.* usage.
 * Unit-testable in Node (depends only on shared/tokenizer.js + stoplist.js
 * via the globalThis.CiteTrace namespace).
 *
 * ── Tiers ────────────────────────────────────────────────────────────────
 * VERBATIM (red):
 *   answer sentence shares a contiguous run of ≥ 8 normalized words with the
 *   source. Additionally, shorter exact runs of 5–7 words count IF the run
 *   contains a number or a proper noun (capitalized token in the original
 *   answer text that is not sentence-initial).
 *
 * PARAPHRASE (orange):
 *   answer sentence vs each source sentence, token-SET Jaccard:
 *     J ≥ 0.55                                  → paraphrase
 *     J ≥ 0.40 AND shared rare tokens ≥ 3       → paraphrase
 *   (rare = normalized token NOT in the 200-word stoplist)
 *   The answer sentence maps to its best-scoring source sentence.
 *
 * ── Worked example (verifies the thresholds) ─────────────────────────────
 * Source sentence:
 *   "The Amazon rainforest produces roughly 20% of the world's oxygen
 *    according to the 2019 survey."
 *   normalized tokens (17):
 *   {the, amazon, rainforest, produces, roughly, 20, of, worlds, oxygen,
 *    according, to, 2019, survey}  → 13 unique
 *
 * Answer sentence A (verbatim lift):
 *   "Scientists say the Amazon rainforest produces roughly 20% of the
 *    world's oxygen."
 *   contains the contiguous 9-token run
 *   [the amazon rainforest produces roughly 20 of the worlds] → run len 10
 *   with "oxygen" ⇒ ≥ 8 ⇒ VERBATIM. ✓
 *
 * Answer sentence B (paraphrase):
 *   "Roughly 20% of Earth's oxygen comes from the Amazon rainforest."
 *   unique tokens: {roughly, 20, of, earths, oxygen, comes, from, the,
 *                   amazon, rainforest} → 10
 *   intersection with source: {roughly, 20, of, oxygen, the, amazon,
 *                              rainforest} → 7
 *   union = 10 + 13 − 7 = 16 ⇒ J = 7/16 ≈ 0.44 → below 0.55, BUT
 *   shared rare tokens: {roughly, 20, amazon, rainforest, oxygen} = 5 ≥ 3
 *   and J ≥ 0.40 ⇒ PARAPHRASE. ✓
 *
 * Answer sentence C (unsupported):
 *   "The forest is also home to two million insect species."
 *   no 5+/8+ run, J ≈ 0.10 ⇒ NOT FOUND IN THIS SOURCE. ✓
 *
 * ── Performance ──────────────────────────────────────────────────────────
 * Source n-grams live in hash maps (key → positions). Answer sentences slide
 * an O(len) window. Paraphrase candidates are pre-selected via an inverted
 * index of non-stopword tokens, so we never do 60 × N full comparisons.
 * 20,000-word source vs 60 answer sentences runs well under 800 ms.
 */
(() => {
  const NS = (globalThis.CiteTrace = globalThis.CiteTrace || {});
  if (NS.Matcher) return;

  const NGRAM_FULL = 8; // verbatim run length
  const NGRAM_SHORT = 5; // shorter run, needs number/proper noun
  const JACCARD_STRONG = 0.55;
  const JACCARD_WEAK = 0.4;
  const RARE_SHARED_MIN = 3;
  const MIN_PARA_TOKENS = 5; // sentences shorter than this skip Jaccard (noise)
  const SEP = "";

  const Tok = () => NS.Tokenizer;
  const stop = () => NS.STOPLIST;

  function gramKey(tokens, i, n) {
    let k = tokens[i].norm;
    for (let j = 1; j < n; j++) k += SEP + tokens[i + j].norm;
    return k;
  }

  /** Map n-gram key -> array of start indices in `tokens`. */
  function buildNgramIndex(tokens, n) {
    const map = new Map();
    for (let i = 0; i + n <= tokens.length; i++) {
      const key = gramKey(tokens, i, n);
      const arr = map.get(key);
      if (arr) arr.push(i);
      else map.set(key, [i]);
    }
    return map;
  }

  /** Extend a seed match maximally to the right. */
  function extendRun(aTokens, ai, sTokens, si, seedLen) {
    let len = seedLen;
    while (
      ai + len < aTokens.length &&
      si + len < sTokens.length &&
      aTokens[ai + len].norm === sTokens[si + len].norm
    ) {
      len++;
    }
    return len;
  }

  /**
   * Find verbatim runs for one answer sentence.
   * Returns [{ aStart, aEnd, sStart, sEnd, len, kind }] (token indices,
   * end exclusive) — kind: "run8" | "run5".
   */
  function findVerbatimRuns(aTokens, sTokens, idx8, idx5, sentenceText) {
    const runs = [];
    const covered = new Array(aTokens.length).fill(false);

    // Pass 1: ≥ 8-token runs
    let i = 0;
    while (i + NGRAM_FULL <= aTokens.length) {
      const positions = idx8.get(gramKey(aTokens, i, NGRAM_FULL));
      if (positions) {
        let best = null;
        for (const p of positions) {
          const len = extendRun(aTokens, i, sTokens, p, NGRAM_FULL);
          if (!best || len > best.len) best = { sStart: p, len };
        }
        runs.push({
          aStart: i,
          aEnd: i + best.len,
          sStart: best.sStart,
          sEnd: best.sStart + best.len,
          len: best.len,
          kind: "run8",
        });
        for (let k = i; k < i + best.len; k++) covered[k] = true;
        i += best.len;
      } else {
        i++;
      }
    }

    // Pass 2: 5–7-token runs containing a number or proper noun.
    // Proper noun = capitalized raw token that is not the sentence's first
    // token (sentence-initial capitalization proves nothing).
    i = 0;
    while (i + NGRAM_SHORT <= aTokens.length) {
      if (covered[i]) {
        i++;
        continue;
      }
      const positions = idx5.get(gramKey(aTokens, i, NGRAM_SHORT));
      if (positions) {
        let best = null;
        for (const p of positions) {
          let len = extendRun(aTokens, i, sTokens, p, NGRAM_SHORT);
          if (len >= NGRAM_FULL) len = NGRAM_FULL - 1; // ≥8 handled in pass 1
          if (!best || len > best.len) best = { sStart: p, len };
        }
        // qualification: window must contain a number or non-initial
        // capitalized token
        let qualified = false;
        for (let k = i; k < i + best.len; k++) {
          const t = aTokens[k];
          if (/\d/.test(t.norm)) {
            qualified = true;
            break;
          }
          if (k > 0 && /^[A-ZÀ-Þ]/.test(t.raw)) {
            qualified = true;
            break;
          }
        }
        // avoid double-reporting anything already inside a run8 region
        const overlaps = runs.some(
          (r) => i < r.aEnd && i + best.len > r.aStart
        );
        if (qualified && !overlaps) {
          runs.push({
            aStart: i,
            aEnd: i + best.len,
            sStart: best.sStart,
            sEnd: best.sStart + best.len,
            len: best.len,
            kind: "run5",
          });
          i += best.len;
          continue;
        }
      }
      i++;
    }

    return runs;
  }

  function intersectionSize(setA, setB) {
    let small = setA;
    let large = setB;
    if (small.size > large.size) {
      small = setB;
      large = setA;
    }
    let n = 0;
    for (const t of small) if (large.has(t)) n++;
    return n;
  }

  function sharedRareCount(setA, setB, stoplist) {
    let small = setA;
    let large = setB;
    if (small.size > large.size) {
      small = setB;
      large = setA;
    }
    let n = 0;
    for (const t of small) {
      if (large.has(t) && !stoplist.has(t)) n++;
    }
    return n;
  }

  /**
   * match(answerSentences, source)
   *
   * answerSentences: array of strings (pre-split answer sentences)
   * source: { text }  — extracted main-content text of the source page
   *
   * Returns {
   *   sentences: [{
   *     index, text, tier: "verbatim"|"paraphrase"|"none",
   *     verbatimRuns: [{ text, sourceStart, sourceEnd, words, kind }],
   *     paraphrase: { sourceStart, sourceEnd, sourceText, similarity,
   *                   sharedRare } | null
   *   }],
   *   highlights:  [{ id, start, end, tier, answerIndex, similarity }],
   *   notFound:    [indices of answer sentences with no match],
   *   figures:     { verified: [{raw, sentenceIndex}],
   *                  unverified: [{raw, sentenceIndex}] },
   *   coverage:    { matchedChars, totalChars, pct },
   *   citedSourceSentences: Set(indices),
   *   sourceSentences: [{ text, start, end }],
   *   elapsedMs
   * }
   */
  function match(answerSentences, source) {
    const t0 = Date.now();
    const T = Tok();
    const STOP = stop();
    const sourceText = source.text;

    const sTokens = T.tokenize(sourceText);
    const sSentences = T.splitSentences(sourceText).map((s) => {
      const toks = T.tokenize(s.text);
      return { ...s, tokens: toks, set: T.tokenSet(toks) };
    });

    const idx8 = buildNgramIndex(sTokens, NGRAM_FULL);
    const idx5 = buildNgramIndex(sTokens, NGRAM_SHORT);

    // inverted index: non-stopword token -> source sentence indices
    const inv = new Map();
    sSentences.forEach((ss, si) => {
      for (const tok of ss.set) {
        if (STOP.has(tok)) continue;
        const arr = inv.get(tok);
        if (arr) arr.push(si);
        else inv.set(tok, [si]);
      }
    });

    const results = [];
    const highlights = [];
    const notFound = [];
    const figures = { verified: [], unverified: [] };
    let hlId = 0;

    // Figure verification corpus: source text with commas removed only
    // (documented limitation: "1.5 million" ≠ "1,500,000").
    const figureCorpus = sourceText.replace(/,/g, "");

    answerSentences.forEach((sentText, index) => {
      const aTokens = T.tokenize(sentText);
      const aSet = T.tokenSet(aTokens);
      const entry = {
        index,
        text: sentText,
        tier: "none",
        verbatimRuns: [],
        paraphrase: null,
      };

      // ── verbatim tier ──
      const runs = findVerbatimRuns(aTokens, sTokens, idx8, idx5, sentText);
      for (const r of runs) {
        const sourceStart = sTokens[r.sStart].start;
        const sourceEnd = sTokens[r.sEnd - 1].end;
        entry.verbatimRuns.push({
          text: sourceText.slice(sourceStart, sourceEnd),
          sourceStart,
          sourceEnd,
          words: r.len,
          kind: r.kind,
        });
        highlights.push({
          id: "ct-hl-" + hlId++,
          start: sourceStart,
          end: sourceEnd,
          tier: "verbatim",
          answerIndex: index,
          similarity: 1,
        });
      }
      if (entry.verbatimRuns.length > 0) entry.tier = "verbatim";

      // ── paraphrase tier ──
      if (aTokens.length >= MIN_PARA_TOKENS) {
        // candidate source sentences via inverted index
        const candCounts = new Map();
        for (const tok of aSet) {
          const list = inv.get(tok);
          if (!list) continue;
          for (const si of list) {
            candCounts.set(si, (candCounts.get(si) || 0) + 1);
          }
        }
        let best = null;
        for (const [si, sharedContent] of candCounts) {
          if (sharedContent < 2) continue; // cheap prefilter
          const ss = sSentences[si];
          if (ss.tokens.length < MIN_PARA_TOKENS) continue;
          const inter = intersectionSize(aSet, ss.set);
          const union = aSet.size + ss.set.size - inter;
          const j = union > 0 ? inter / union : 0;
          if (j < JACCARD_WEAK) continue;
          const rare = sharedRareCount(aSet, ss.set, STOP);
          const qualifies =
            j >= JACCARD_STRONG || (j >= JACCARD_WEAK && rare >= RARE_SHARED_MIN);
          if (!qualifies) continue;
          if (!best || j > best.similarity) {
            best = {
              sourceStart: ss.start,
              sourceEnd: ss.end,
              sourceText: ss.text,
              similarity: j,
              sharedRare: rare,
              si,
            };
          }
        }
        if (best) {
          entry.paraphrase = best;
          if (entry.tier === "none") entry.tier = "paraphrase";
          highlights.push({
            id: "ct-hl-" + hlId++,
            start: best.sourceStart,
            end: best.sourceEnd,
            tier: "paraphrase",
            answerIndex: index,
            similarity: best.similarity,
          });
        }
      }

      if (entry.tier === "none") notFound.push(index);

      // ── figure verification ──
      for (const fig of T.extractFigures(sentText)) {
        if (figureCorpus.includes(fig.norm)) {
          figures.verified.push({ raw: fig.raw, sentenceIndex: index });
        } else {
          figures.unverified.push({ raw: fig.raw, sentenceIndex: index });
        }
      }

      results.push(entry);
    });

    // ── resolve overlapping highlights (verbatim beats paraphrase) ──
    const finalHighlights = resolveOverlaps(highlights);

    // ── coverage: merged matched chars / total chars ──
    let matchedChars = 0;
    const merged = mergeRanges(
      finalHighlights.map((h) => [h.start, h.end])
    );
    for (const [a, b] of merged) matchedChars += b - a;
    const totalChars = sourceText.length;

    // ── which SOURCE sentences got cited (for the citability profile) ──
    const citedSourceSentences = new Set();
    sSentences.forEach((ss, si) => {
      for (const h of finalHighlights) {
        if (h.start < ss.end && h.end > ss.start) {
          citedSourceSentences.add(si);
          break;
        }
      }
    });

    return {
      sentences: results,
      highlights: finalHighlights,
      notFound,
      figures,
      coverage: {
        matchedChars,
        totalChars,
        pct: totalChars > 0 ? Math.round((matchedChars / totalChars) * 100) : 0,
      },
      citedSourceSentences,
      sourceSentences: sSentences.map(({ text, start, end }) => ({
        text,
        start,
        end,
      })),
      elapsedMs: Date.now() - t0,
    };
  }

  /** Merge [start,end) ranges. */
  function mergeRanges(ranges) {
    const sorted = ranges.slice().sort((a, b) => a[0] - b[0]);
    const out = [];
    for (const r of sorted) {
      const last = out[out.length - 1];
      if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
      else out.push([r[0], r[1]]);
    }
    return out;
  }

  /**
   * Overlap resolution for rendering: verbatim ranges win over paraphrase.
   * Paraphrase ranges are clipped against all verbatim ranges; same-tier
   * overlaps are left as-is (the highlighter merges them per node).
   */
  function resolveOverlaps(highlights) {
    const verbatim = highlights.filter((h) => h.tier === "verbatim");
    const out = [...verbatim];
    for (const p of highlights) {
      if (p.tier !== "paraphrase") continue;
      let pieces = [[p.start, p.end]];
      for (const v of verbatim) {
        const next = [];
        for (const [a, b] of pieces) {
          if (v.end <= a || v.start >= b) {
            next.push([a, b]);
            continue;
          }
          if (a < v.start) next.push([a, v.start]);
          if (v.end < b) next.push([v.end, b]);
        }
        pieces = next;
        if (pieces.length === 0) break;
      }
      pieces.forEach(([a, b], i) => {
        if (b - a < 3) return; // sub-3-char slivers aren't worth painting
        out.push({ ...p, id: p.id + (i > 0 ? "-" + i : ""), start: a, end: b });
      });
    }
    return out.sort((a, b) => a.start - b.start);
  }

  NS.Matcher = {
    match,
    // exported for unit tests
    _internal: {
      buildNgramIndex,
      findVerbatimRuns,
      mergeRanges,
      resolveOverlaps,
      NGRAM_FULL,
      NGRAM_SHORT,
      JACCARD_STRONG,
      JACCARD_WEAK,
      RARE_SHARED_MIN,
    },
  };
})();
