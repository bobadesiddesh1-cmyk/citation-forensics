/**
 * CiteTrace highlighter — wraps matched source passages in styled spans and
 * keeps a restore registry that puts the ORIGINAL text nodes back, so
 * "Clear" is byte-exact by construction: we never mutate the original nodes,
 * we only park them and re-insert them on restore.
 *
 * Registry entry: { parent, anchor, original, inserted[] }
 *   restore = insert `original` before inserted[0], remove all inserted.
 */
(() => {
  const NS = (globalThis.CiteTrace = globalThis.CiteTrace || {});
  if (NS.Highlighter) return;

  const COLORS = {
    verbatim: { bg: "rgba(239, 68, 68, 0.22)", line: "#EF4444" },
    paraphrase: { bg: "rgba(249, 115, 22, 0.18)", line: "#F97316" },
  };

  let registry = []; // [{ parent, original, inserted }]
  let spansById = new Map(); // highlight id -> [span]
  let infoById = new Map(); // highlight id -> highlight object
  let clickHandler = null;
  let delegatedListener = null;

  /** Locate segments overlapping [start,end) — segments are sorted by start. */
  function overlappingSegments(segments, start, end) {
    // binary search for first segment with seg.end > start
    let lo = 0;
    let hi = segments.length - 1;
    let first = segments.length;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (segments[mid].end > start) {
        first = mid;
        hi = mid - 1;
      } else {
        lo = mid + 1;
      }
    }
    const out = [];
    for (let i = first; i < segments.length && segments[i].start < end; i++) {
      out.push(segments[i]);
    }
    return out;
  }

  function makeSpan(doc, hl) {
    const c = COLORS[hl.tier] || COLORS.paraphrase;
    const span = doc.createElement("span");
    span.setAttribute("data-citetrace-id", hl.id);
    span.setAttribute("data-citetrace-tier", hl.tier);
    // inline styles only — never depends on (or collides with) host CSS
    span.style.background = c.bg;
    span.style.borderBottom = "2px solid " + c.line;
    span.style.cursor = "pointer";
    span.style.borderRadius = "2px";
    span.style.transition = "box-shadow 0.3s ease";
    return span;
  }

  /**
   * apply(extraction, highlights, onClick)
   *   extraction: result of Extract.extract()
   *   highlights: [{ id, start, end, tier, answerIndex, similarity }]
   *   onClick(highlightInfo, domRect): highlight click callback
   * Returns number of highlights actually painted.
   */
  function apply(extraction, highlights, onClick) {
    clear(); // never double-apply
    clickHandler = onClick || null;
    const doc = extraction.root.ownerDocument;
    const segments = extraction.segments;

    for (const hl of highlights) infoById.set(hl.id, hl);

    // 1. compute per-node pieces: node -> [{ ns, ne, hl }]
    const byNode = new Map();
    for (const hl of highlights) {
      for (const seg of overlappingSegments(segments, hl.start, hl.end)) {
        const ns = Math.max(hl.start, seg.start) - seg.start;
        const ne = Math.min(hl.end, seg.end) - seg.start;
        if (ne <= ns) continue;
        let list = byNode.get(seg.node);
        if (!list) byNode.set(seg.node, (list = []));
        list.push({ ns, ne, hl });
      }
    }

    // 2. rebuild each affected node as [text][span][text][span][text]…
    let painted = 0;
    for (const [node, rawPieces] of byNode) {
      try {
        if (!node.parentNode || !node.isConnected) continue;
        // sort + merge overlaps (matcher already clips cross-tier overlaps;
        // same-tier overlaps merge keeping the first id)
        const pieces = rawPieces
          .slice()
          .sort((a, b) => a.ns - b.ns)
          .reduce((acc, p) => {
            const last = acc[acc.length - 1];
            if (last && p.ns < last.ne) {
              last.ne = Math.max(last.ne, p.ne);
            } else {
              acc.push({ ...p });
            }
            return acc;
          }, []);

        const value = node.nodeValue;
        const parent = node.parentNode;
        const frag = doc.createDocumentFragment();
        const inserted = [];
        let cursor = 0;
        for (const p of pieces) {
          if (p.ns > cursor) {
            const t = doc.createTextNode(value.slice(cursor, p.ns));
            frag.appendChild(t);
            inserted.push(t);
          }
          const span = makeSpan(doc, p.hl);
          span.textContent = value.slice(p.ns, p.ne);
          frag.appendChild(span);
          inserted.push(span);
          let arr = spansById.get(p.hl.id);
          if (!arr) spansById.set(p.hl.id, (arr = []));
          arr.push(span);
          cursor = p.ne;
          painted++;
        }
        if (cursor < value.length) {
          const t = doc.createTextNode(value.slice(cursor));
          frag.appendChild(t);
          inserted.push(t);
        }

        parent.insertBefore(frag, node);
        parent.removeChild(node); // original PARKED, untouched, in registry
        registry.push({ parent, original: node, inserted });
      } catch (e) {
        /* host page mutated under us — skip this node, keep going */
      }
    }

    // 3. one delegated click listener for all highlight spans
    if (!delegatedListener) {
      delegatedListener = (ev) => {
        try {
          const el =
            ev.target && ev.target.closest
              ? ev.target.closest("[data-citetrace-id]")
              : null;
          if (!el || !clickHandler) return;
          const id = el.getAttribute("data-citetrace-id");
          const info = infoById.get(id);
          if (!info) return;
          ev.preventDefault();
          ev.stopPropagation();
          clickHandler(info, el.getBoundingClientRect());
        } catch (e) {
          /* never break the host page */
        }
      };
      doc.addEventListener("click", delegatedListener, true);
    }

    return painted;
  }

  /** Restore the DOM byte-exact: re-insert originals, remove everything we added. */
  function clear() {
    for (let i = registry.length - 1; i >= 0; i--) {
      const { parent, original, inserted } = registry[i];
      try {
        const first = inserted.find((n) => n.parentNode === parent);
        if (first) {
          parent.insertBefore(original, first);
        } else if (parent.isConnected) {
          parent.appendChild(original);
        }
        for (const n of inserted) {
          if (n.parentNode) n.parentNode.removeChild(n);
        }
      } catch (e) {
        /* keep restoring the rest */
      }
    }
    registry = [];
    spansById = new Map();
    infoById = new Map();
    if (delegatedListener) {
      try {
        document.removeEventListener("click", delegatedListener, true);
      } catch (e) {
        /* ignore */
      }
      delegatedListener = null;
    }
  }

  /** Scroll the first span of a highlight into view and pulse all its spans. */
  function scrollTo(id) {
    const spans = spansById.get(id);
    if (!spans || spans.length === 0) return false;
    try {
      spans[0].scrollIntoView({ behavior: "smooth", block: "center" });
      const tier = spans[0].getAttribute("data-citetrace-tier");
      const line = (COLORS[tier] || COLORS.paraphrase).line;
      for (const s of spans) {
        s.style.boxShadow = "0 0 0 3px " + line;
      }
      setTimeout(() => {
        for (const s of spans) s.style.boxShadow = "none";
      }, 1200);
    } catch (e) {
      /* ignore */
    }
    return true;
  }

  function stats() {
    return { registryEntries: registry.length, highlightIds: spansById.size };
  }

  NS.Highlighter = { apply, clear, scrollTo, stats, COLORS };
})();
