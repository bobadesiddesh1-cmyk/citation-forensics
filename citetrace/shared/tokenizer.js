/**
 * CiteTrace tokenizer — pure functions, no DOM, no chrome.* usage.
 * Loaded in content scripts AND requirable in Node for unit testing
 * (everything hangs off globalThis.CiteTrace).
 */
(() => {
  const NS = (globalThis.CiteTrace = globalThis.CiteTrace || {});
  if (NS.Tokenizer) return; // idempotent: file may be injected twice on AI hosts

  /**
   * Token regex:
   *  - currency-prefixed numbers:  $1,500.25  €30  £1.2
   *  - plain numbers, optionally with commas/decimals/percent: 1,500  3.14  45%
   *  - words: latin letters incl. accents, internal apostrophes/hyphens kept
   */
  const TOKEN_RE =
    /[$€£]\d[\d,]*(?:\.\d+)?|\d[\d,]*(?:\.\d+)?%?|[A-Za-zÀ-ɏ]+(?:['’’-][A-Za-zÀ-ɏ]+)*/g;

  /**
   * Normalize one raw token:
   *  lowercase, drop currency symbols / % / commas / apostrophes / hyphens,
   *  keep letters, digits and the decimal point ("1.5" stays "1.5").
   */
  function normToken(raw) {
    let t = raw.toLowerCase();
    t = t.replace(/[$€£%,'’’-]/g, "");
    // strip stray leading/trailing dots ("etc." -> "etc") but keep "1.5"
    t = t.replace(/^\.+|\.+$/g, "");
    return t;
  }

  /**
   * tokenize(text) -> [{ raw, norm, start, end }]
   * start/end are character offsets into the ORIGINAL string, so matches can
   * be mapped back onto the live DOM byte-exactly.
   */
  function tokenize(text) {
    const out = [];
    TOKEN_RE.lastIndex = 0;
    let m;
    while ((m = TOKEN_RE.exec(text)) !== null) {
      const norm = normToken(m[0]);
      if (norm.length === 0) continue;
      out.push({ raw: m[0], norm, start: m.index, end: m.index + m[0].length });
    }
    return out;
  }

  /** Set of normalized tokens for Jaccard comparisons. */
  function tokenSet(tokens) {
    const s = new Set();
    for (const t of tokens) s.add(t.norm);
    return s;
  }

  // Abbreviations that end with "." but do not end a sentence.
  const ABBREV = new Set([
    "mr", "mrs", "ms", "dr", "prof", "sr", "jr", "st", "vs", "etc", "eg",
    "ie", "e.g", "i.e", "fig", "no", "vol", "al", "inc", "ltd", "co", "corp",
    "approx", "dept", "est", "min", "max", "u.s", "u.k", "u.n", "gov", "ca",
    "cf", "ch", "ed", "pp", "para", "sec", "avg",
  ]);

  const OPENERS = "\"'“”‘’([";

  /**
   * splitSentences(text) -> [{ text, start, end }]
   * Offsets refer to the original string. Deliberately conservative:
   *  - '.' between digits never splits (3.14)
   *  - known abbreviations and single-letter initials never split (Dr., J.)
   *  - any newline is a boundary (block-ish text from the DOM)
   */
  function splitSentences(text) {
    const out = [];
    let start = 0;

    const push = (from, to) => {
      // trim while keeping true offsets
      let a = from;
      let b = to;
      while (a < b && /[\s"'“”‘’()\[\]]/.test(text[a])) a++;
      while (b > a && /\s/.test(text[b - 1])) b--;
      if (b - a >= 2) out.push({ text: text.slice(a, b), start: a, end: b });
    };

    for (let i = 0; i < text.length; i++) {
      const ch = text[i];

      if (ch === "\n") {
        push(start, i);
        start = i + 1;
        continue;
      }

      if (ch !== "." && ch !== "!" && ch !== "?") continue;

      if (ch === ".") {
        const prev = text[i - 1];
        const next = text[i + 1];
        // decimal number: 3.14
        if (/\d/.test(prev || "") && /\d/.test(next || "")) continue;
        // preceding word check for abbreviations / initials
        let ws = i - 1;
        while (ws >= 0 && /[A-Za-z.À-ɏ]/.test(text[ws])) ws--;
        const word = text.slice(ws + 1, i).toLowerCase();
        if (ABBREV.has(word)) continue;
        if (word.length === 1 && /[a-z]/.test(word)) continue; // "J. Smith"
      }

      // swallow runs of enders: "?!", "...", "!?"
      let j = i;
      while (j + 1 < text.length && /[.!?]/.test(text[j + 1])) j++;

      // boundary only if followed by end-of-text, whitespace, or a closer
      const after = text[j + 1];
      if (after !== undefined && !/\s/.test(after) && !OPENERS.includes(after)) {
        i = j;
        continue;
      }

      push(start, j + 1);
      i = j;
      start = j + 1;
    }
    push(start, text.length);
    return out;
  }

  /** Figures: currency amounts, percentages, plain numbers (with commas/decimals). */
  const FIGURE_RE =
    /[$€£]\s?\d[\d,]*(?:\.\d+)?|\d[\d,]*(?:\.\d+)?\s?%|\d[\d,]*(?:\.\d+)?/g;

  /**
   * extractFigures(text) -> [{ raw, norm }]
   * norm: commas and internal spaces removed ("$1,500" -> "$1500", "45 %" -> "45%").
   * Bare single digits (1–9) are skipped — they match almost any page and
   * produce pure noise (logged in DECISIONS.md).
   */
  function extractFigures(text) {
    const out = [];
    FIGURE_RE.lastIndex = 0;
    let m;
    while ((m = FIGURE_RE.exec(text)) !== null) {
      const raw = m[0];
      const norm = raw.replace(/[,\s]/g, "");
      if (/^\d$/.test(norm)) continue; // bare single digit
      out.push({ raw, norm });
    }
    return out;
  }

  NS.Tokenizer = {
    tokenize,
    normToken,
    tokenSet,
    splitSentences,
    extractFigures,
  };
})();
