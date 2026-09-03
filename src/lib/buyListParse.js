// buyListParse.js — parse a pasted buy list and rank catalog candidates for each line.
// Pure ES module, no imports.
//
// Exports:
//   parseBuyList(text)                       -> [{ raw, qty, name, note }]
//   expandTokens(str)                        -> array of normalized lowercase tokens
//   rankCandidates(lineName, products, opts) -> ranked [{ id, name, score, exact }]
//
// House rules baked in (battle-tested — see CLAUDE.md 8/19 duplicate-guard notes):
// - form words (box / pack / etb / bundle / tin / blister / deck / collection / sleeved)
//   are DECISIVE, never similarity votes;
// - Jaccard over the union, never divide by the shorter side;
// - ties break by fewest leftover candidate tokens (closest fit first, not biggest stock);
// - never guess: a qty is only what the line literally says, and rankCandidates returns []
//   rather than a bad match.

const SHORTHAND = {
  pb: ['pitch', 'black'],
  dr: ['destined', 'rivals'],
  pc: ['pokemon', 'center'],
  pkc: ['pokemon', 'center'],
  etb: ['elite', 'trainer', 'box'],
  ah: ['ascended', 'heroes'],
  cr: ['chaos', 'rising'],
  jt: ['journey', 'together'],
  spc: ['super', 'premium', 'collection'],
  upc: ['ultra', 'premium', 'collection'],
  bb: ['booster', 'box'],
  wf: ['white', 'flare'],
};

const SINGULAR = {
  boxes: 'box',
  packs: 'pack',
  tins: 'tin',
  etbs: 'etb',
  bundles: 'bundle',
  decks: 'deck',
  blisters: 'blister',
  posters: 'poster',
  sets: 'set',
};

// Set-code tokens ("op17", "st-22", "prb2") must never be expanded or mangled.
const SET_CODE_RX = /^(op|st|eb|prb|sv|me|m)-?\d+$/i;
const SET_PREFIX_RX = /^(op|st|eb|prb|sv|me|m)$/i;
// Same prefix but three digits or more: a set NAME behind a series letter ("SV 151"),
// not a set code. Split so the compact spelling normalizes exactly like the spaced one.
const LONG_CODE_RX = /^(op|st|eb|prb|sv|me|m)-?(\d{3,})$/i;

// Brand words carry no identity (brand/language are separate columns) — stripped from
// BOTH input and candidate tokens so "pkc" -> pokemon center matches "PC ETB" symmetrically.
const BRAND_WORDS = new Set(['pokemon', 'one', 'piece', 'tcg', 'card', 'game', 'the', 'of']);

const LANG_TOKENS = {
  chinese: 'CN', cn: 'CN',
  japanese: 'JP', jp: 'JP',
  english: 'EN', en: 'EN',
};

// Words that describe packaging rather than the set's identity. Used only to compute the
// "non-form tokens" minimal bar — form CLASS decisions live in formClassOf().
const FORM_TOKENS = new Set([
  'box', 'booster', 'pack', 'sleeved', 'elite', 'trainer', 'etb', 'bundle', 'tin',
  'blister', 'deck', 'starter', 'collection', 'poster', 'premium', 'super', 'ultra',
  'gift', 'single', 'three',
]);

/**
 * Parse a pasted buy list. One line -> one row { raw, qty, name, note }.
 * qty comes ONLY from a leading integer, a trailing " - N", or a trailing "xN"/"x N".
 * A parenthetical becomes `note` (stripped from the name). Lines with no qty marker
 * keep qty: null — never invent a quantity.
 *
 * Order matters, and it is not the obvious one. The store writes
 * "151 booster bundle x10 $1800": a set name that opens with digits, an explicit
 * quantity marker, and a trailing amount. Reading left to right takes 151 as the
 * quantity and hands back "booster bundle x10" as the product. So a trailing
 * amount comes off first (it goes to `note`, never to qty — the figures the store
 * writes are market value, not what we paid), then an EXPLICIT marker, and only a
 * line with no marker at all falls back to a leading integer.
 */
export function parseBuyList(text) {
  const rows = [];
  for (const rawLine of String(text ?? '').split(/\r?\n/)) {
    if (!rawLine.trim()) continue; // blank lines skipped
    const raw = rawLine;

    // Pull out parentheticals as the note before any qty parsing
    const notes = [];
    let line = rawLine.replace(/\(([^)]*)\)/g, (_, inner) => {
      const t = String(inner).trim();
      if (t) notes.push(t);
      return ' ';
    });
    line = line.replace(/\s+/g, ' ').trim();

    let qty = null;
    let name = line;
    let m;

    // Trailing "$510" / "US$1,800.00" / "$1,800 USD" — recorded as a note, never as
    // a price and never as a quantity. Left in place it also breaks the "xN" rule,
    // because the number at the end of the line is the amount rather than the count.
    //
    // The currency word and the trailing period matter more than they look. If the
    // amount is not recognised it stays on the line, "x10" is then no longer at the
    // end either, and the leading-integer fallback reads "151 booster bundle x10
    // $1,800 USD" as 151 units. One unmatched spelling of the amount turns into a
    // wrong quantity two rules later.
    if ((m = name.match(/^(.*?)\s*(?:US)?\$\s*([\d,]+(?:\.\d{1,2})?)\s*(?:USD)?\s*\.?\s*$/i))) {
      notes.push(`listed $${m[2]}`);
      name = m[1].trim();
    }
    const note = notes.length ? notes.join('; ') : null;

    if ((m = name.match(/^(.*?)\s+x\s*(\d+)$/i))) {
      // trailing "xN" / "x N" — explicit, so it beats a leading integer
      qty = parseInt(m[2], 10);
      name = m[1];
    } else if ((m = name.match(/^(.*?)\s+[-–]\s*(\d+)$/))) {
      // trailing " - N" (space before the dash required, so "op-17" is never a qty)
      qty = parseInt(m[2], 10);
      name = m[1];
    } else if ((m = name.match(/^(\d+)\s+(.*)$/))) {
      // leading integer = qty, but only with no explicit marker anywhere on the line
      qty = parseInt(m[1], 10);
      name = m[2];
    }

    name = name.replace(/\s*[-–]\s*$/, '').replace(/\s+/g, ' ').trim();
    rows.push({ raw, qty, name, note });
  }
  return rows;
}

/**
 * Tokenize + normalize a string:
 * - lowercase, split on non-letter/non-digit runs (Unicode-aware; CJK runs stay whole);
 * - adjacent set-code pieces re-merge ("st 22" / "st-22" / "ST22" all -> "st22");
 * - set-code tokens are NEVER expanded by the shorthand map;
 * - plural form words singularized (boxes->box ... sets->set);
 * - store shorthand expanded on whole tokens only (pb -> pitch black, etb -> elite trainer box ...).
 */
export function expandTokens(str) {
  const rawTokens = String(str ?? '').toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];

  // Re-merge set codes split by the tokenizer: ["st","22"] -> "st22".
  // Capped at two digits because every set code we carry is (OP-17, ST-36, EB-03,
  // PRB-2, M6). Three digits means the number is a set NAME, not a code — the
  // catalog row "SV 151 Booster Bundle" was merging to "sv151", which no line
  // saying "151 booster bundle" could ever match.
  const merged = [];
  for (let i = 0; i < rawTokens.length; i++) {
    const t = rawTokens[i];
    const next = rawTokens[i + 1];
    if (SET_PREFIX_RX.test(t) && next && /^\d{1,2}$/.test(next)) {
      merged.push(t + next);
      i++;
      continue;
    }
    merged.push(t);
  }

  const out = [];
  for (let t of merged) {
    // Split before the set-code branch, which would otherwise swallow "sv151" whole
    // and leave it unable to match the catalog row spelled "SV 151". Both spellings
    // have to come out the same or the two stop finding each other.
    const long = t.match(LONG_CODE_RX);
    if (long) {
      out.push(long[1].toLowerCase(), long[2]);
      continue;
    }
    if (SET_CODE_RX.test(t)) {
      out.push(t.replace('-', '')); // normalized set code stays as one token
      continue;
    }
    t = SINGULAR[t] || t;
    const exp = SHORTHAND[t];
    if (exp) {
      out.push(...exp);
      continue;
    }
    out.push(t);
  }
  return out;
}

/**
 * Form class of a token list. Form words are decisive:
 * - etb beats box ("elite trainer box" is an ETB, not a box);
 * - blister beats pack ("3-pack blister" is a blister);
 * - "collection box" is a box, bare "collection"/poster/spc/upc is a collection;
 * - sleeved is form-defining, not noise.
 */
function formClassOf(tokens) {
  const has = (t) => tokens.includes(t);
  if (has('sleeved')) return 'sleeved';
  if (has('elite') && has('trainer')) return 'etb';
  if (has('blister')) return 'blister';
  if (has('bundle')) return 'bundle';
  if (has('tin')) return 'tin';
  if (has('deck')) return 'deck';
  if (has('box')) return 'box';
  if (has('collection') || has('poster')) return 'collection';
  if (has('pack')) return 'pack';
  return null;
}

/**
 * Token sets for a product: its name plus each alias (aliases may be a "|"-separated
 * string, an array, or null; "MERGED_INTO:..." entries are markers, not names).
 * Names go through the same expandTokens normalization as the input — otherwise
 * catalog rows literally named "... PC ETB" could never match an expanded input.
 * [EN]/[JP]/[CN] tags and brand words are stripped.
 */
function candidateTokenSets(p) {
  const names = [];
  if (p && p.name) names.push(String(p.name));
  const a = p ? p.aliases : null;
  const aliasList = Array.isArray(a) ? a : (typeof a === 'string' && a ? a.split('|') : []);
  for (const al of aliasList) {
    const s = String(al || '').trim();
    if (!s || /^MERGED_INTO:/i.test(s)) continue;
    names.push(s);
  }

  const sets = [];
  for (const n of names) {
    const cleaned = n.replace(/\[\s*(en|jp|cn)\s*\]/gi, ' ');
    const toks = expandTokens(cleaned).filter((t) => !BRAND_WORDS.has(t));
    if (!toks.length) continue;
    sets.push([...new Set(toks)]);
  }
  return sets;
}

/**
 * Rank catalog candidates for one buy-list line.
 * opts: { limit: 5, formGate: true }. formGate:false exists ONLY so tests can prove the
 * form gate is load-bearing — never pass it from production code.
 * Returns [{ id, name, score, exact }]; [] rather than a bad guess.
 */
export function rankCandidates(lineName, products, opts = {}) {
  const limit = Number.isFinite(opts.limit) ? opts.limit : 5;
  const formGate = opts.formGate !== false;

  // Input tokens: expand shorthand, peel language tags, strip brand words
  let langPref = null;
  const kept = [];
  for (const t of expandTokens(lineName)) {
    if (LANG_TOKENS[t]) {
      if (!langPref) langPref = LANG_TOKENS[t];
      continue;
    }
    kept.push(t);
  }
  const inputSet = new Set(kept.filter((t) => !BRAND_WORDS.has(t)));
  if (inputSet.size === 0) return [];
  const inputTokens = [...inputSet];
  const inputForm = formClassOf(inputTokens);
  const nonFormInput = inputTokens.filter((t) => !FORM_TOKENS.has(t));

  const scored = [];
  for (const p of products || []) {
    if (!p || p.active === false) continue; // only explicit false is retired

    let best = null;
    for (const candTokens of candidateTokenSets(p)) {
      const candForm = formClassOf(candTokens);

      if (formGate) {
        // A candidate whose form class is known and DIFFERENT is excluded entirely
        if (inputForm && candForm && candForm !== inputForm) continue;
        // sleeved only matches sleeved, in both directions
        if ((inputForm === 'sleeved') !== (candForm === 'sleeved')) continue;
      }

      const candSet = new Set(candTokens);
      let matched = 0;
      for (const t of inputSet) if (candSet.has(t)) matched++;
      if (matched === 0) continue;

      // Minimal bar: at least half of the input's non-form tokens must match,
      // otherwise return nothing rather than a bad guess.
      if (nonFormInput.length) {
        let m = 0;
        for (const t of nonFormInput) if (candSet.has(t)) m++;
        if (m * 2 < nonFormInput.length) continue;
      }

      // Jaccard over the union — never divide by the shorter side
      let union = candSet.size;
      for (const t of inputSet) if (!candSet.has(t)) union++;
      const jaccard = matched / union;
      const leftovers = candSet.size - matched;
      const langMatch = !!(langPref && p.language && String(p.language).toUpperCase() === langPref);
      const score = jaccard + (langMatch ? 0.5 : 0);
      // exact only when the match is perfect in BOTH directions
      const exact = matched === inputSet.size && matched === candSet.size;

      if (!best || score > best.score || (score === best.score && leftovers < best.leftovers)) {
        best = { score, leftovers, exact };
      }
    }

    if (best) {
      scored.push({ id: p.id, name: p.name, score: best.score, exact: best.exact, leftovers: best.leftovers });
    }
  }

  scored.sort((a, b) =>
    (b.score - a.score) ||
    (a.leftovers - b.leftovers) || // fewest leftover candidate tokens: closest fit first
    String(a.name).localeCompare(String(b.name))
  );

  return scored.slice(0, limit).map(({ id, name, score, exact }) => ({ id, name, score, exact }));
}
