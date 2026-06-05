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
// us nothing about the SKU). Keep this small — we want the match to leverage
// distinguishing terms like "first partner", "30th anniversary", etc.
const NAME_STOPWORDS = new Set([
  'a', 'an', 'the',
  'box', 'boxes', 'pack', 'packs',
  'etb', 'collection', 'tin', 'bundle',
  'of', 'and', 'or', '&',
])

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
 * Returns null if nothing scores well enough — caller falls back to
 * "no match, pick a product manually".
 *
 * Scoring: split the input name into content tokens (stopwords removed),
 * count how many appear in `${brand} ${name} ${category}` for each
 * product, normalize by token count, and pick the best ≥ 0.5.
 */
function fuzzyMatchProduct(rawName, products) {
  const lower = trim(rawName).toLowerCase()
  if (!lower) return null
  const tokens = lower
    .split(/\s+/)
    .filter(t => t && !NAME_STOPWORDS.has(t))
  if (tokens.length === 0) return null

  let best = null
  let bestScore = 0
  for (const p of products) {
    const hay = `${p.brand || ''} ${p.name || ''} ${p.category || ''}`.toLowerCase()
    let hits = 0
    for (const t of tokens) {
      if (hay.includes(t)) hits++
    }
    // Normalize so a short distinctive name like "first partner" scoring
    // 2/2 beats a longer name that incidentally hits 3 stopwords.
    const score = hits / tokens.length
    if (score > bestScore) {
      bestScore = score
      best = p
    }
  }

  // Require ≥ 50% token match AND at least 1 hit. Otherwise call it ambiguous.
  if (best && bestScore >= 0.5) {
    return { product: best, score: bestScore }
  }
  return null
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

    const match = fuzzyMatchProduct(name, products)
    out.push({
      qty,
      cost,         // per-unit price (in original currency)
      total,        // line total = cost × qty (sanity-checkable in UI)
      productName: name,   // raw text from the message
      productMatch: match
        ? { id: match.product.id, product: match.product, score: match.score }
        : null,
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
