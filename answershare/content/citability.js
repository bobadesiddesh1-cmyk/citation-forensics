/**
 * CiteTrace citability profile — pure stats, no DOM, no chrome.* usage.
 * Answers the SEO/AEO question: "what do the passages the AI cited have in
 * common?" so professionals can structure content the same way.
 *
 * Input:
 *   sourceSentences: [{ text, start, end }]   (offsets into extracted text)
 *   citedIndices:    Set of indices into sourceSentences that were matched
 *   meta: {
 *     liRanges:    [[start,end], ...]  extracted-text ranges inside <li>
 *     headingEnds: [offset, ...]       extracted-text offsets where a
 *                                      heading's text ended
 *   }
 *   totalLen: length of extracted text
 *
 * All stats are deterministic; takeaways are template-based (no LLM).
 */
(() => {
  const NS = (globalThis.CiteTrace = globalThis.CiteTrace || {});
  if (NS.Citability) return;

  const HEADING_FOLLOW_WINDOW = 8; // chars between heading end and sentence start

  function wordCount(text) {
    return NS.Tokenizer.tokenize(text).length;
  }

  function hasNumber(text) {
    return /\d/.test(text);
  }

  function inRanges(start, end, ranges) {
    for (const [a, b] of ranges) {
      if (start < b && end > a) return true;
    }
    return false;
  }

  function followsHeading(start, headingEnds) {
    for (const he of headingEnds) {
      if (start >= he && start - he <= HEADING_FOLLOW_WINDOW) return true;
    }
    return false;
  }

  function pct(part, whole) {
    return whole > 0 ? Math.round((part / whole) * 100) : 0;
  }

  function avg(nums) {
    if (nums.length === 0) return 0;
    return Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 10) / 10;
  }

  /**
   * analyze(...) -> {
   *   stats: {
   *     citedCount, uncitedCount,
   *     avgWordsCited, avgWordsUncited,
   *     positionPct: { first, middle, last },       // of cited sentences
   *     numberPctCited, numberPctUncited,
   *     listPctCited, headingPctCited
   *   },
   *   takeaways: [string, string, ...]              // 2–3 lines
   * }
   */
  function analyze({ sourceSentences, citedIndices, meta, totalLen }) {
    const cited = [];
    const uncited = [];
    sourceSentences.forEach((s, i) => {
      const rec = {
        words: wordCount(s.text),
        number: hasNumber(s.text),
        list: inRanges(s.start, s.end, meta.liRanges || []),
        heading: followsHeading(s.start, meta.headingEnds || []),
        third:
          totalLen > 0
            ? s.start < totalLen / 3
              ? "first"
              : s.start < (2 * totalLen) / 3
                ? "middle"
                : "last"
            : "first",
      };
      (citedIndices.has(i) ? cited : uncited).push(rec);
    });

    const positionPct = {
      first: pct(cited.filter((c) => c.third === "first").length, cited.length),
      middle: pct(cited.filter((c) => c.third === "middle").length, cited.length),
      last: pct(cited.filter((c) => c.third === "last").length, cited.length),
    };

    const stats = {
      citedCount: cited.length,
      uncitedCount: uncited.length,
      avgWordsCited: avg(cited.map((c) => c.words)),
      avgWordsUncited: avg(uncited.map((c) => c.words)),
      positionPct,
      numberPctCited: pct(cited.filter((c) => c.number).length, cited.length),
      numberPctUncited: pct(uncited.filter((c) => c.number).length, uncited.length),
      listPctCited: pct(cited.filter((c) => c.list).length, cited.length),
      headingPctCited: pct(cited.filter((c) => c.heading).length, cited.length),
    };

    return { stats, takeaways: buildTakeaways(stats) };
  }

  /** Deterministic, template-based takeaway lines. Always returns 2–3. */
  function buildTakeaways(s) {
    const lines = [];
    if (s.citedCount === 0) {
      return [
        "No source passages were matched, so there is no citability pattern to report for this page.",
        "Try tracing a citation whose answer clearly draws on this page's text.",
      ];
    }

    // 1. Sentence length
    if (s.avgWordsUncited > 0 && s.avgWordsCited <= s.avgWordsUncited * 0.85) {
      lines.push(
        `Cited passages here are short (avg ${s.avgWordsCited} words vs ${s.avgWordsUncited} for uncited text) — tight, self-contained sentences get lifted.`
      );
    } else if (
      s.avgWordsUncited > 0 &&
      s.avgWordsCited >= s.avgWordsUncited * 1.15
    ) {
      lines.push(
        `Cited passages here are longer than average (avg ${s.avgWordsCited} words vs ${s.avgWordsUncited}) — the AI favored this page's fuller explanatory sentences.`
      );
    } else {
      lines.push(
        `Cited passages average ${s.avgWordsCited} words — roughly in line with the rest of the page, so length wasn't the selection signal here.`
      );
    }

    // 2. Numbers
    if (s.numberPctCited >= 40 && s.numberPctCited > s.numberPctUncited) {
      lines.push(
        `${s.numberPctCited}% of cited sentences contain a number (vs ${s.numberPctUncited}% of uncited ones) — number-dense statements are what got quoted. Lead with concrete figures.`
      );
    } else if (s.numberPctCited <= 15) {
      lines.push(
        `Only ${s.numberPctCited}% of cited sentences contain a number — on this page the AI pulled qualitative statements, not data points.`
      );
    }

    // 3. Position
    const pos = s.positionPct;
    const dominant =
      pos.first >= 50 ? "first" : pos.middle >= 50 ? "middle" : pos.last >= 50 ? "last" : null;
    if (dominant) {
      const label = { first: "opening third", middle: "middle third", last: "final third" }[dominant];
      lines.push(
        `${pos[dominant]}% of cited passages sit in the ${label} of the document — put your key claims there.`
      );
    }

    // 4. Structure (only if we still need a line)
    if (lines.length < 3) {
      if (s.headingPctCited >= 25) {
        lines.push(
          `${s.headingPctCited}% of cited sentences sit directly under a heading — front-load each section with its key fact, right after the H2/H3.`
        );
      } else if (s.listPctCited >= 25) {
        lines.push(
          `${s.listPctCited}% of cited sentences live inside list items — scannable bullets are getting picked up here.`
        );
      }
    }

    return lines.slice(0, 3);
  }

  NS.Citability = { analyze, _internal: { buildTakeaways } };
})();
