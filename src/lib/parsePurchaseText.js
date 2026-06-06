// Free-form purchase-message → structured suggestion. Staff paste a vendor
// chat like:
//
//   9489 1472 2842 6840 2627 67
//
//   45 first partner boxes
//   $49x45=$2,205.00
//
//   29 30th anniversary boxes
//   $31x29=$899.00
//
//   $2,205+$899=$3,104.00
//
//   Zelle
//   504-303-2659
//   Tien Nguyen
//
// and we return {tracking, lineItems, paymentMethod, vendor, rawTotal}
// for the form to pre-fill. Pure-JS, no network. Heuristic — caller MUST
// surface the parse to the user for confirmation before saving.

// Common words that hurt product matching (a vendor's casual "boxes" tells
// us nothing about the SKU). Keep this short and ONLY words that are pure
// noise — anything that can distinguish two SKUs stays (e.g. don't drop
// "english" / "japanese" / "1st-edition").
const NAME_STOPWORDS = new Set([
  'a', 'an', 'the',
  'of', 'and', 'or', '&',
])

// Trade abbreviations vendors use casually. Expanded into both the short
// form and the full form so token matching catches "BB" against a product
// named "Booster Box" AND vice-versa. Maps abbrev → full-form tokens.
const ABBREVIATIONS = {
  bb:     ['booster', 'box'],
  bbs:    ['booster', 'box'],
  etb:    ['elite', 'trainer', 'box'],
  etbs:   ['elite', 'trainer', 'box'],
  pc:     ['premium', 'collection'],
  upc:    ['ultra', 'premium', 'collection'],
  cb:     ['collection', 'box'],
  bp:     ['booster', 'pack'],
  bps:    ['booster', 'pack'],
  op:     ['one', 'piece'],
  ygo:    ['yugioh'],
  mtg:    ['magic'],
  pkmn:   ['pokemon'],
  pkm:    ['pokemon'],
  poke:   ['pokemon'],
  jp:     ['japanese'],
  en:     ['english'],
  cn:     ['chinese'],
  kr:     ['korean'],
}

// Words that strongly hint a CATEGORY. If the input contains one, products
// whose `category` matches get a score boost — handles "Stellar Crown box"
// (which is ambiguous between Booster Box and Collection Box) more sanely.
const CATEGORY_HINTS = {
  box:       ['box'],
  boxes:     ['box'],
  booster:   ['booster'],
  elite:     ['elite trainer'],
  trainer:   ['elite trainer'],
  etb:       ['elite trainer'],
  premium:   ['premium'],
  pc:        ['premium'],
  upc:       ['ultra premium'],
  collection:['collection'],
  pack:      ['pack'],
  packs:     ['pack'],
  bundle:    ['bundle'],
  tin:       ['tin'],
}

// Lightweight stemmer — strips trailing 's' / 'es' / "th"/"st"/"nd"/"rd"
// on numerals. Lets "boxes" → "box", "packs" → "pack", "30th" → "30",
// "2nd" → "2", etc. Keeps the original token too so distinctive forms
// don't disappear ("packing" doesn't lose its meaning to "pack").
const stem = (t) => {
  const forms = new Set([t])
  if (t.endsWith('es') && t.length > 3) forms.add(t.slice(0, -2))
  if (t.endsWith('s') && t.length > 2) forms.add(t.slice(0, -1))
  const ord = t.match(/^(\d+)(st|nd|rd|th)$/i)
  if (ord) forms.add(ord[1])
  return Array.from(forms)
}

// Expand abbreviations + stemming for the SEARCH side of a fuzzy match.
// Input "first partner boxes" → ["first", "partner", "box", "boxes"].
// Input "stellar crown etb" → ["stellar", "crown", "elite", "trainer", "box"].
const expandTokens = (text) => {
  const raw = String(text || '')
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')   // strip punctuation but keep digits
    .split(/\s+/)
    .filter(Boolean)
  const out = new Set()
  for (const t of raw) {
    if (NAME_STOPWORDS.has(t)) continue
    if (ABBREVIATIONS[t]) {
      for (const x of ABBREVIATIONS[t]) out.add(x)
    }
    for (const s of stem(t)) out.add(s)
  }
  return Array.from(out)
}

const PAYMENT_KEYWORDS = [
  // Each tuple: [regex-source for keyword, canonical label].
  // Order matters — longest/most-specific first so "cash app" doesn't get
  // eaten by "cash".
  ['cash\\s?app', 'Cash App'],
  ['cashapp',    'Cash App'],
  ['zelle',      'Zelle'],
  ['venmo',      'Venmo'],
  ['paypal',     'PayPal'],
  ['wire(?:\\s+transfer)?', 'Wire'],
  ['bitcoin|btc', 'Bitcoin'],
  ['cash',       'Cash'],
  ['check',      'Check'],
]

// USPS = 22 digits, UPS = 18, FedEx = 12–14, DHL = 10–11. Allow optional
// spaces/dashes between digit groups. Reject sequences that are obviously
// dollar amounts (would be much shorter — handled by the >= 10 floor).
const TRACKING_RE = /(?:\d[\s-]?){10,30}/g

// "$49x45=$2,205.00" or "$49 x 45" or "49×45=2205" (loose). Captures
// per-unit price, qty, and (optional) total.
const PRICE_TIMES_QTY_RE =
  /\$?\s*([\d,]+(?:\.\d+)?)\s*[x×*]\s*([\d,]+)\s*(?:=\s*\$?\s*([\d,]+(?:\.\d+)?))?/i

// "qty + name" lead-in for a line item. "45 first partner boxes",
// "45x first partner boxes", "Qty: 45 First Partner Boxes". The name
// portion is captured for fuzzy matching against the products list.
const QTY_NAME_RE = /^(?:qty[:\s]*)?(\d+)\s*x?\s+([^\n$]+?)\s*$/i

// (XXX) XXX-XXXX, XXX-XXX-XXXX, XXX.XXX.XXXX, +1 XXX XXX XXXX. We
// pick the FIRST plausible phone in the text — vendor messages rarely
// contain more than one.
const PHONE_RE = /(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/

// Two-or-three-word capitalized name (first + last, or first + middle + last).
// Used to spot "Tien Nguyen" / "Mary Beth Smith" at the bottom of a message.
const PERSON_NAME_RE = /^([A-Z][a-z']{1,15}(?:\s+[A-Z][a-z']{1,15}){1,2})\s*$/

const num = (s) => Number(String(s).replace(/,/g, ''))
const trim = (s) => String(s || '').trim()

/**
 * Fuzzy-match a free-text product name against the catalog.
 * Returns:
 *   {
 *     best: { product, score } | null,   // best match if it cleared 50%
 *     candidates: [{ product, score }],  // up to 3 alternates ≥ 30%
 *                                        // (excludes best to avoid dupes)
 *   }
 *
 * Scoring:
 *   1. Expand input tokens (BB → booster box, 30th → 30, boxes → box).
 *   2. For each product, build a haystack of brand + name + category and
 *      expand the SAME way.
 *   3. token_overlap = (hits / input_tokens_count). Distinct hits — a
 *      product mentioning "box" 3 times still scores 1 for that token.
 *   4. category_boost: if the input's category hint matches the product
 *      category, +0.15 (caps at 1.0). Distinguishes "Stellar Crown box"
 *      between Booster Box and Collection Box.
 *   5. Tiebreak by product.id length (stable) so re-renders don't reshuffle.
 */
function fuzzyMatchProduct(rawName, products) {
  const tokens = expandTokens(rawName)
  if (tokens.length === 0) return { best: null, candidates: [] }

  // Which categories does this input hint at? (e.g. "box" → ["box"]).
  const inputLower = String(rawName || '').toLowerCase()
  const hintedCategories = new Set()
  for (const word of inputLower.split(/\s+/)) {
    const hints = CATEGORY_HINTS[word]
    if (hints) for (const h of hints) hintedCategories.add(h)
  }

  const ranked = []
  for (const p of products) {
    const hay = new Set(expandTokens(`${p.brand || ''} ${p.name || ''} ${p.category || ''}`))
    let hits = 0
    for (const t of tokens) {
      if (hay.has(t)) hits++
    }
    let score = hits / tokens.length
    // Category boost — only if the input clearly hinted at a category and
    // the product's category matches one of the hints.
    if (hintedCategories.size > 0 && p.category) {
      const cat = String(p.category).toLowerCase()
      for (const h of hintedCategories) {
        if (cat.includes(h)) { score = Math.min(1, score + 0.15); break }
      }
    }
    if (score > 0) ranked.push({ product: p, score })
  }
  ranked.sort((a, b) => b.score - a.score)

  // Pick the best if it cleared the high-confidence bar (≥ 0.5).
  const top = ranked[0]
  const best = top && top.score >= 0.5 ? top : null
  // Alternate candidates: next 3 ≥ 0.3. If no strong best, surface the top
  // few in case the autoselect is wrong — staff don't have to scrub the
  // whole catalog. Excludes the chosen `best` to avoid duplicate entries.
  const candidates = ranked
    .filter(c => c.score >= 0.3 && (!best || c.product.id !== best.product.id))
    .slice(0, 3)
  return { best, candidates }
}

function pickTracking(text) {
  const candidates = text.match(TRACKING_RE) || []
  for (const c of candidates) {
    const digits = c.replace(/[^0-9]/g, '')
    if (digits.length >= 10 && digits.length <= 30) return digits
  }
  return null
}

function pickPayment(text, paymentMethods) {
  for (const [src, canonical] of PAYMENT_KEYWORDS) {
    if (new RegExp(`\\b${src}\\b`, 'i').test(text)) {
      const existing = (paymentMethods || []).find(pm =>
        new RegExp(`^${src}$`, 'i').test(pm.name) ||
        pm.name?.toLowerCase() === canonical.toLowerCase()
      )
      return {
        id: existing?.id || null,
        label: existing?.name || canonical,
        // suggestNew=true means "we found this keyword but no matching
        // saved payment method — caller may want to offer 'Add new'".
        suggestNew: !existing,
      }
    }
  }
  return null
}

function pickVendor(text, vendors) {
  const phone = (text.match(PHONE_RE) || [null])[0]
  // Search the last 6 non-empty lines for "First Last" — vendors typically
  // sign off at the end of the message.
  const tail = text
    .split(/\n/)
    .map(trim)
    .filter(Boolean)
    .slice(-6)
    .reverse()
  let name = null
  for (const line of tail) {
    const m = line.match(PERSON_NAME_RE)
    if (m) { name = m[1]; break }
  }
  if (!name && !phone) return null
  const existing = name
    ? (vendors || []).find(v => v.name?.toLowerCase().includes(name.split(' ')[0].toLowerCase()))
    : null
  return {
    id: existing?.id || null,
    name: name || existing?.name || null,
    phone,
    suggestNew: !existing && !!name,
  }
}

/**
 * Parse the qty/name + price lines into line items. Walks the message
 * top-to-bottom, treating each "<qty> <name>" line as the start of a
 * line item and pairing it with the next "$price x qty = $total" line
 * within a small look-ahead window (so blank lines between them don't
 * break the pair).
 */
// Lines that are nothing but digits and spaces / dashes (e.g. a tracking
// number "9489 1472 2842 6840 2627 67") get parsed as qty + name unless we
// reject them up front — otherwise they steal the next price line and the
// REAL "45 first partner boxes" entry below gets eaten.
const looksLikeTracking = (line) => {
  if (!/^[\d\s-]+$/.test(line)) return false
  const digits = line.replace(/[^0-9]/g, '')
  return digits.length >= 10
}

function pickLineItems(text, products) {
  const lines = text.split(/\n/).map(trim)
  const out = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!line || line.startsWith('$')) continue  // summary totals start with $
    if (looksLikeTracking(line)) continue        // skip the tracking row
    const qm = line.match(QTY_NAME_RE)
    if (!qm) continue
    const qty = parseInt(qm[1], 10)
    const name = trim(qm[2])
    // Skip if the matched "name" is just digits (tracking residue) or empty.
    // Also reject implausibly large qtys (≥ 10k) — those are almost always
    // a tracking-number prefix that slipped through.
    if (!name || /^[\d\s-]+$/.test(name) || qty > 10000) continue

    // Look ahead up to 3 lines for a price-times-qty pattern.
    let cost = null, total = null
    for (let j = i + 1; j <= Math.min(i + 3, lines.length - 1); j++) {
      const pm = lines[j].match(PRICE_TIMES_QTY_RE)
      if (pm) {
        cost = num(pm[1])
        if (pm[3] != null) total = num(pm[3])
        else if (cost != null) total = cost * qty
        i = j  // consume the price line
        break
      }
    }
    if (cost == null && total == null) continue  // qty+name with no price → skip

    const { best, candidates } = fuzzyMatchProduct(name, products)
    out.push({
      qty,
      cost,         // per-unit price (in original currency)
      total,        // line total = cost × qty (sanity-checkable in UI)
      productName: name,   // raw text from the message
      productMatch: best
        ? { id: best.product.id, product: best.product, score: best.score }
        : null,
      // Alternate candidates the UI surfaces as quick-pick chips when the
      // auto-match looks weak (or wrong) — saves the cashier from typing
      // into SearchableSelect when the right answer is in the top few.
      productCandidates: candidates.map(c => ({
        id: c.product.id, product: c.product, score: c.score,
      })),
    })
  }
  return out
}

function pickGrandTotal(text) {
  // Look for "$X+$Y=$Z" or the largest $ amount as a fallback.
  const sumMatch = text.match(/=\s*\$?\s*([\d,]+(?:\.\d+)?)/)
  if (sumMatch) {
    const candidates = (text.match(/\$\s*([\d,]+(?:\.\d+)?)/g) || [])
      .map(s => num(s.replace('$', '')))
      .filter(n => Number.isFinite(n))
    if (candidates.length) return Math.max(...candidates)
  }
  return null
}

/**
 * Main entry. All three reference lists are optional — pass what you have.
 * Returns:
 *   {
 *     tracking: string|null,
 *     lineItems: [{qty, cost, total, productName, productMatch}],
 *     paymentMethod: {id, label, suggestNew}|null,
 *     vendor: {id, name, phone, suggestNew}|null,
 *     rawTotal: number|null,    // grand total we found in the text
 *   }
 */
export function parsePurchaseText(text, { products = [], paymentMethods = [], vendors = [] } = {}) {
  const safe = String(text || '')
  return {
    tracking: pickTracking(safe),
    lineItems: pickLineItems(safe, products),
    paymentMethod: pickPayment(safe, paymentMethods),
    vendor: pickVendor(safe, vendors),
    rawTotal: pickGrandTotal(safe),
  }
}
