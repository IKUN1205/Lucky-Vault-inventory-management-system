// Big-family grouping for the count sheet (Gary 2026-08-21: "第一件事是分品类
// op/ pokemon/ weiss/ marvel 这种大品类 这样他们好区分").
//
// The category comes from the product NAME first and only falls back to the
// brand column, because brand is known to be mislabeled (OP-15 Kami's
// Adventure carries brand=Pokemon — the count-message simplification dropped
// the brand line for exactly this reason). Name rules are checked in a fixed
// order, so the One Piece rule claims Kami before the Pokemon brand fallback
// ever sees it.
//
// Keep the rules COARSE. This drives shelf-walking order for a person holding
// a phone, not analytics — a wrong bucket costs a moment of confusion, an
// over-clever rule costs a debugging session.

export const CATEGORY_ORDER = [
  { key: 'onepiece', label: 'One Piece' },
  { key: 'pokemon', label: 'Pokemon' },
  { key: 'dragonball', label: 'Dragon Ball' },
  { key: 'weiss', label: 'Weiss Schwarz' },
  { key: 'marvel', label: 'Marvel / Upper Deck' },
  { key: 'lorcana', label: 'Lorcana' },
  { key: 'hololive', label: 'hololive' },
  { key: 'gundam', label: 'Gundam' },
  { key: 'yugioh', label: 'Yu-Gi-Oh' },
  { key: 'other', label: 'Other' },
]

const RANK = Object.fromEntries(CATEGORY_ORDER.map((c, i) => [c.key, i]))
const LABEL = Object.fromEntries(CATEGORY_ORDER.map(c => [c.key, c.label]))

// Japanese/Chinese Pokemon sets whose names never say "Pokemon". Mirrors the
// kaitori set-code table (M1–M6 families) plus the CN sets we stock.
const POKE_SET_RX = new RegExp(
  [
    'storm emeralda', 'abyss eye', 'inferno x', 'mega brave', 'mega symphonia',
    'mega dream', 'mega evolution', 'munikis', 'nully zero', 'nihil zero',
    'ninja spinner', 'gem vol', 'terastal', 'poke ?ball', 'poke ?bar',
    'journey together', 'destined rivals', 'prismatic evolutions',
    'crown zenith', 'hidden fates', 'evolving skies', 'paldean?', '\\b151\\b',
    'black bolt', 'white flare', 'shining legends', 'shining fates',
    'celebrations', 'scarlet', 'vivid voltage', 'battle styles',
    'fusion strike', 'chaos rising',
    // JP-warehouse fire-set single-pack buckets: "m4（fire） Single Pack" etc.
    // (M2=Inferno X … M6=Storm — the M codes are Pokemon JP sets)
    'm\\d+a?\\s*[（(]fire[）)]',
  ].join('|'), 'i')

const RULES = [
  // One Piece FIRST: OP-nn set codes are unambiguous and beat every fallback
  // (this is what rescues the brand-mislabeled Kami SKU).
  ['onepiece', /one ?piece|\bOP[- ]?\d|\bOP Illustration|\bEB[- ]?0\d|azure sea/i],
  ['dragonball', /dragon ?ball|\bFB[- ]?\d|fusion world|\bDBS\b/i],
  ['weiss', /weiss|schwarz/i],
  ['marvel', /marvel|upper deck|\bUD\b/i],
  ['lorcana', /lorcana|disney/i],
  ['hololive', /hololive|ayakashi|enchant regalia/i],
  ['gundam', /gundam|freedom ascension/i],
  ['yugioh', /yu-?gi-?oh|yugioh|chaos origins|rarity collection quarter/i],
  // Pokemon LAST among the named rules: its set list is long and the loosest.
  ['pokemon', POKE_SET_RX],
  ['pokemon', /pok[eé]mon/i],
]

const BRAND_KEYS = {
  'one piece': 'onepiece',
  'pokemon': 'pokemon',
  'dragon ball': 'dragonball',
  'weiss schwarz': 'weiss',
  'marvel': 'marvel',
  'lorcana': 'lorcana',
  'hololive': 'hololive',
  'gundam': 'gundam',
  'yugioh': 'yugioh',
  'yu-gi-oh': 'yugioh',
}

/** Category key for a product ({name, brand} or a bare name string). */
export function categoryOf(product) {
  const name = (typeof product === 'string' ? product : product?.name) || ''
  for (const [key, rx] of RULES) {
    if (rx.test(name)) return key
  }
  const brand = ((typeof product === 'object' && product?.brand) || '').trim().toLowerCase()
  return BRAND_KEYS[brand] || 'other'
}

export function categoryLabel(key) {
  return LABEL[key] || 'Other'
}

export function categoryRank(key) {
  return RANK[key] ?? RANK.other
}
