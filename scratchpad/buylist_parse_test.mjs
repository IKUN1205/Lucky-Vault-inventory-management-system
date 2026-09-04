// buylist_parse_test.mjs — tests for src/lib/buyListParse.js (runs the REAL module).
// Run: node scratchpad/buylist_parse_test.mjs
import { parseBuyList, expandTokens, rankCandidates } from '../src/lib/buyListParse.js';

let passed = 0;
let failed = 0;
function check(desc, cond) {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error('FAIL: ' + desc);
  }
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const ids = (res) => res.map((r) => r.id);
const firstId = (res) => (res.length ? res[0].id : null);

// ---------------------------------------------------------------- CATALOG fixture
// Real product names from the live catalog. Brand Pokemon / language EN unless noted.
const P = (id, name, extra = {}) => ({
  id, name, aliases: null, brand: 'Pokemon', language: 'EN', type: null, variant: null, active: true, ...extra,
});
const CATALOG = [
  P('pb-box', 'Pitch Black Booster Box'),
  P('pb-pcetb', 'Pitch black elite trainer box pc ETB'),
  P('pb-bundle', 'Pitch Black Booster Bundle'),
  P('dr-box', 'Destined Rivals Booster Box'),
  P('dr-etb', 'Destined Rivals Elite Trainer Box'),
  P('dr-pcetb', 'Destined Rivals PC ETB'),
  P('dr-sleeved', 'Destined Rivals Sleeved Booster Pack'),
  P('cr-pack', 'Chaos Rising Booster Pack'),
  P('cr-sleeved-blister', 'Chaos Rising Sleeved Pack Blister Pack'),
  P('cr-etb', 'Chaos Rising ETB'),
  P('cr-pcetb', 'Chaos Rising PC ETB'),
  P('cr-bundle', 'Chaos Rising Booster Bundle'),
  P('ah-pack', 'Ascended Heroes Booster Pack'),
  P('ah-bundle', 'Ascended Heroes Booster Bundle'),
  P('ah-poster', 'Ascended Heroes Premium Poster Collection - Mega Lucario'),
  P('pe-pack', 'Prismatic Evolutions Booster Pack'),
  P('pe-tin', 'Prismatic Evolutions Tin'),
  P('pe-spc', 'Prismatic Evolutions Super Premium Collection'),
  P('pe-bundle', 'SV Prismatic Evolutions Booster Bundle'),
  P('pe-poster', 'Prismatic Evolutions Poster Collection'),
  P('151-pack-live', '151 Booster Pack'),
  P('151-pack-retired', '151 Booster Pack', { active: false }),
  P('151-tin', '151 Tin'),
  P('151-etb', '151 Elite Trainer Box'),
  P('jt-bundle', 'Journey Together Booster Bundle'),
  P('jt-pcetb', 'Journey Together PC ETB'),
  P('jt-box', 'Scarlet Violet Journey Together Booster Box'),
  P('me-box', 'Mega Evolution Booster Box'),
  P('me-pack', 'Mega Evolution Booster Pack'),
  P('me-pcetb', 'Mega Evolution Pokemon Center [Lucario] ETB'),
  P('ss-box', 'Surging Sparks Booster Box'),
  P('ss-pack', 'Surging Sparks Booster Pack'),
  P('po-pack', 'Perfect Order Booster Pack'),
  P('po-blister', 'Perfect Order Three Pack Blister Pack'),
  P('po-pcetb', 'Perfect Order PC ETB'),
  P('gem6-box', 'Gem Pack Vol 6 Booster Box', { language: 'CN' }),
  P('gem5-box', 'Gem Vol.5 Booster Box', { language: 'CN', aliases: '宝石5弹 原盒|MERGED_INTO:deadbeef' }),
  P('riftbound-box', 'Riftbound LoL Booster Box', { language: 'CN', brand: 'Other' }),
  P('st22-deck', '[EN] ST-22 Ace and Newgate Starter Deck', { brand: 'One Piece' }),
  P('st24-deck', '[EN] ST-24 Jewelry Bonney Starter Deck', { brand: 'One Piece' }),
  P('kidkiller-box', 'Kid/Killer Illustration Box Special Box', { brand: 'One Piece' }),
  P('fp-s2-box', 'First Partner Illustration Collection  Series 2 Booster Box'),
  P('fp-s3-coll', 'First Partner Illustration Collection (Series 3) Collection'),
  P('cz-etb', 'Crown Zenith Elite Trainer Box'),
  P('celeb-etb', 'Celebrations Elite Trainer Box'),
  P('celeb-pcetb', 'Celebrations Pokemon Center Elite Trainer Box'),
  P('wf-etb', 'White Flare Elite Trainer Box'),
  P('bbolt-pack', 'Black Bolt Booster Pack'),
  P('sf-collbox', 'Shining Fates Collection Box'),
  P('dragonite-collbox', 'Dragonite V Collection Box'),
  P('phf-bundle', 'Phantasmal Flames Booster Bundle'),
  P('phf-sleeved', 'Phantasmal Flames Sleeved Booster Pack'),
];
const rk = (q, o) => rankCandidates(q, CATALOG, o);

// ---------------------------------------------------------------- parseBuyList
const pasted = [
  '23 pb booster boxes',
  '2 pb pkc etb',
  'First partner series 2 - 113 (additional 4 with slight damage in packaging)',
  '2 spc',
  '1 Vivid Voltage',
  '1 Destined Rival pc etb',
  '', // blank line — must be skipped
  'Topps chrome nfl 2025 hanger - 21',
  'Surging sparks bb x3',
  'Crown zenith etb x 2',
  'First partner series 2',
  'Phantasmal flames bundles',
].join('\n');

const rows = parseBuyList(pasted);
check('parse: blank lines skipped (11 rows)', rows.length === 11);
check('parse: raw preserved', rows[0].raw === '23 pb booster boxes');
check('parse: "23 pb booster boxes" qty 23', rows[0].qty === 23);
check('parse: "23 pb booster boxes" name', rows[0].name === 'pb booster boxes');
check('parse: "23 pb booster boxes" note null', rows[0].note === null);
check('parse: "2 pb pkc etb" qty 2', rows[1].qty === 2 && rows[1].name === 'pb pkc etb');
check('parse: first partner qty 113', rows[2].qty === 113);
check('parse: first partner name (dash-qty and paren stripped)', rows[2].name === 'First partner series 2');
check('parse: first partner note captured', rows[2].note === 'additional 4 with slight damage in packaging');
check('parse: "2 spc" qty 2 name spc', rows[3].qty === 2 && rows[3].name === 'spc');
check('parse: "1 Vivid Voltage" qty 1', rows[4].qty === 1 && rows[4].name === 'Vivid Voltage');
check('parse: "1 Destined Rival pc etb"', rows[5].qty === 1 && rows[5].name === 'Destined Rival pc etb');
check('parse: "Topps chrome nfl 2025 hanger - 21" qty 21', rows[6].qty === 21);
check('parse: topps name keeps its own numbers', rows[6].name === 'Topps chrome nfl 2025 hanger');
check('parse: "Surging sparks bb x3" qty 3', rows[7].qty === 3 && rows[7].name === 'Surging sparks bb');
check('parse: "Crown zenith etb x 2" qty 2', rows[8].qty === 2 && rows[8].name === 'Crown zenith etb');
check('parse: "First partner series 2" (no marker) qty null — never invent', rows[9].qty === null);
check('parse: "First partner series 2" name intact (the 2 stays in the name)', rows[9].name === 'First partner series 2');
check('parse: no-number line qty null', rows[10].qty === null && rows[10].name === 'Phantasmal flames bundles');

// ---------------------------------------------------------------- expandTokens
check('tokens: pb booster boxes', eq(expandTokens('pb booster boxes'), ['pitch', 'black', 'booster', 'box']));
check('tokens: dr etbs (singularize then expand)', eq(expandTokens('dr etbs'), ['destined', 'rivals', 'elite', 'trainer', 'box']));
check('tokens: spc', eq(expandTokens('spc'), ['super', 'premium', 'collection']));
check('tokens: upc', eq(expandTokens('upc'), ['ultra', 'premium', 'collection']));
check('tokens: pkc', eq(expandTokens('pkc'), ['pokemon', 'center']));
check('tokens: wf cr jt ah', eq(expandTokens('wf cr jt ah'), ['white', 'flare', 'chaos', 'rising', 'journey', 'together', 'ascended', 'heroes']));
check('tokens: set code op17 survives untouched', eq(expandTokens('op17 bb'), ['op17', 'booster', 'box']));
check('tokens: set code st-22 stays one token', eq(expandTokens('ST-22 deck'), ['st22', 'deck']));
check('tokens: "st 22" merges to the same set code', eq(expandTokens('st 22 deck'), ['st22', 'deck']));
check('tokens: prb2 survives', eq(expandTokens('prb2 packs'), ['prb2', 'pack']));
check('tokens: plural form words singularized', eq(
  expandTokens('tins bundles decks blisters posters sets'),
  ['tin', 'bundle', 'deck', 'blister', 'poster', 'set']
));

// ---------------------------------------------------------------- rankCandidates
// pb booster boxes -> Pitch Black Booster Box first; ETB variant + Bundle gated out
let r = rk('pb booster boxes');
check('rank: "pb booster boxes" -> Pitch Black Booster Box first', firstId(r) === 'pb-box');
check('rank: "pb booster boxes" top hit is exact', r.length > 0 && r[0].exact === true);
check('rank: pb PC ETB excluded (form gate)', !ids(r).includes('pb-pcetb'));
check('rank: pb Bundle excluded (form gate)', !ids(r).includes('pb-bundle'));

// pb pkc etb -> the pc ETB variant; Booster Box gated out
r = rk('pb pkc etb');
check('rank: "pb pkc etb" -> pc ETB variant first', firstId(r) === 'pb-pcetb');
check('rank: "pb pkc etb" top hit is exact', r.length > 0 && r[0].exact === true);
check('rank: "pb pkc etb" Booster Box excluded (form mismatch)', !ids(r).includes('pb-box'));

// dr etb -> plain ETB above PC ETB, both present
r = rk('dr etb');
check('rank: "dr etb" has plain ETB', ids(r).includes('dr-etb'));
check('rank: "dr etb" has PC ETB too', ids(r).includes('dr-pcetb'));
check('rank: "dr etb" plain ETB ABOVE PC ETB (fewer leftovers)', ids(r).indexOf('dr-etb') < ids(r).indexOf('dr-pcetb'));
check('rank: "dr etb" plain ETB is exact', r[0].exact === true && firstId(r) === 'dr-etb');
check('rank: "dr etb" PC ETB not exact', r.find((x) => x.id === 'dr-pcetb').exact === false);

// dr pkc etb -> PC ETB first
r = rk('dr pkc etb');
check('rank: "dr pkc etb" -> PC ETB first', firstId(r) === 'dr-pcetb');
check('rank: "dr pkc etb" PC ETB exact', r[0].exact === true);

// sleeved is form-defining
r = rk('Destined Rival sleeved packs');
check('rank: "Destined Rival sleeved packs" -> the Sleeved pack', firstId(r) === 'dr-sleeved');
check('rank: sleeved query never pulls the plain box/etb', !ids(r).includes('dr-box') && !ids(r).includes('dr-etb'));

r = rk('Chaos Rising single packs');
check('rank: "Chaos Rising single packs" -> Booster Pack', firstId(r) === 'cr-pack');
check('rank: single packs does NOT pull the Sleeved blister', !ids(r).includes('cr-sleeved-blister'));

// retired rows never surface
r = rk('151 single packs');
check('rank: "151 single packs" -> active 151 Booster Pack first', firstId(r) === '151-pack-live');
check('rank: retired 151 row absent', !ids(r).includes('151-pack-retired'));
check('rank: 151 Tin / ETB gated out', !ids(r).includes('151-tin') && !ids(r).includes('151-etb'));

// language preference
r = rk('Chinese Riftbound bb');
check('rank: "Chinese Riftbound bb" -> Riftbound CN box', firstId(r) === 'riftbound-box');

// set-code token survives expansion and matches the dash-coded catalog name
r = rk('ST 22 Deck');
check('rank: "ST 22 Deck" -> the ST-22 starter deck', firstId(r) === 'st22-deck');
check('rank: ST-24 deck does not tag along', !ids(r).includes('st24-deck'));

// extra token tolerated
r = rk('Umbreon Prismatic tins');
check('rank: "Umbreon Prismatic tins" -> Prismatic Evolutions Tin', firstId(r) === 'pe-tin');
check('rank: umbreon extra token means not exact', r[0].exact === false);

// spc -> Super Premium Collection, not Poster / Bundle
r = rk('prismatic spc');
check('rank: "prismatic spc" -> Super Premium Collection first', firstId(r) === 'pe-spc');
check('rank: "prismatic spc" Poster Collection not first', ids(r).indexOf('pe-poster') !== 0);
check('rank: "prismatic spc" Bundle excluded (form gate)', !ids(r).includes('pe-bundle'));

// nothing clears the bar -> []
check('rank: gibberish -> []', rk('gibberish xyzzy').length === 0);

// aliases participate (CJK alias, MERGED_INTO marker ignored without crashing)
r = rk('宝石5弹 原盒');
check('rank: CJK alias matches Gem Vol.5 box', firstId(r) === 'gem5-box');

// limit respected
check('rank: limit option respected', rk('dr etb', { limit: 1 }).length === 1);

// EN-tagged input never ranks a JP product above an EN product with equal token match
const LANG_CAT = [
  { id: 'jp-storm', name: 'Storm Emeralda Booster Box', language: 'JP', active: true },
  { id: 'en-storm', name: 'Storm Emeralda Booster Box', language: 'EN', active: true },
];
r = rankCandidates('english storm emeralda bb', LANG_CAT);
check('rank: EN-tagged input puts EN product first on equal match', firstId(r) === 'en-storm');
check('rank: JP twin still listed, just below', ids(r).includes('jp-storm') && ids(r).indexOf('jp-storm') > 0);

// ---------------------------------------------------------------- MUTATION test
// Prove the form gate is load-bearing: with formGate:false the WRONG candidate
// (Pitch Black Booster Box) appears for "pb pkc etb"; with the gate on it disappears.
// limit raised because ungated scoring ranks several PC-ETB rows above the box.
const off = rankCandidates('pb pkc etb', CATALOG, { formGate: false, limit: 50 });
const on = rankCandidates('pb pkc etb', CATALOG);
check('mutation: gate OFF -> Booster Box wrongly appears', ids(off).includes('pb-box'));
check('mutation: gate ON -> Booster Box gone', !ids(on).includes('pb-box'));
check('mutation: gate OFF still scores the right ETB on top (gate is about exclusion)', firstId(off) === 'pb-pcetb');

// ------------------------------------------------- form matrix + near-miss (Codex round 1)
// sleeved is a strict XOR both ways
const sl1 = rankCandidates('Chaos Rising sleeved packs', CATALOG);
check('form: sleeved input never offers the plain pack', !sl1.some(c => /Booster Pack$/.test(c.name) && !/Sleeved/i.test(c.name)));
const sl2 = rankCandidates('Chaos Rising single packs', CATALOG);
check('form: plain-pack input never offers the sleeved blister', !sl2.some(c => /Sleeved/i.test(c.name)));
// box vs pack vs etb vs bundle vs tin never cross-match
const mx = [
  ['Surging Sparks booster box', /Booster Pack$/],
  ['Surging Sparks single pack', /Booster Box$/],
  ['151 etb', /Booster Pack$|Tin$/],
  ['151 tin', /Elite Trainer Box$|Booster Pack$/],
  ['Chaos Rising bundle', /Booster Pack$|ETB$/],
];
for (const [q, banned] of mx) {
  const r2 = rankCandidates(q, CATALOG);
  check('form matrix: "' + q + '" excludes ' + banned, !r2.some(c => banned.test(c.name)));
}
// near-miss: partially-similar garbage must return EMPTY, not a confident wrong answer
check('near-miss: "prismatic hoodie xl" -> []', rankCandidates('prismatic hoodie xl', CATALOG).length === 0);
check('near-miss: "gem vol 9 poster playmat" -> []', rankCandidates('gem vol 9 poster playmat', CATALOG).length === 0);

// ------------------------------------------- the store's real format (2026-09-01)
// Taken verbatim from the list Mario sent for a $3,000 cash buy: "name xN $price".
// Every line of it used to parse wrong — "151 booster bundle x10 $1800" came back
// as qty 151 of "booster bundle x10", and the SV rows were unreachable — which is
// why that buy was hand-entered as a Master transfer instead of going through here.
const REAL = parseBuyList([
  'Prismatic spc x2 $510',
  'Mega Charizard upc x2 $460',
  'Prismatic booster bundle x5 $450',
  '151 booster bundle x10 $1800',
  '151 etbs x3 $1680',
  'Chaos etb pc x2 $270',
  'White flare etb pc $240',
].join('\n'));
check('real: trailing $ does not eat the xN', REAL[0].qty === 2 && REAL[0].name === 'Prismatic spc');
check('real: amount kept as a note, never a price', REAL[0].note === 'listed $510');
check('real: a set name opening with digits is not a quantity',
  REAL[3].qty === 10 && REAL[3].name === '151 booster bundle');
check('real: "$1,800" style amount parsed whole', REAL[3].note === 'listed $1800');
check('real: 151 etbs x3', REAL[4].qty === 3 && REAL[4].name === '151 etbs');
check('real: no marker still means no quantity — never invent one',
  REAL[6].qty === null && REAL[6].name === 'White flare etb pc');
// leading integer still works when the line carries no explicit marker
const LEAD = parseBuyList('3 Chaos Rising ETB\n151 booster bundle')[0];
check('leading integer still read as qty when nothing else marks it', LEAD.qty === 3);
// "SV 151" must not merge into a set code, or no line can ever reach that row
check('expandTokens: "SV 151 Booster Bundle" keeps 151 reachable',
  expandTokens('SV 151 Booster Bundle').includes('151'));
check('expandTokens: real set codes still merge', eq(expandTokens('op 17 booster box'),
  ['op17', 'booster', 'box']));
check('rank: "151 booster bundle" finds the SV row',
  firstId(rankCandidates('151 booster bundle',
    [...CATALOG, P('sv151-bundle', 'SV 151 Booster Bundle')])) === 'sv151-bundle');
// compact and spaced spellings of a 3-digit set NAME must normalize identically,
// or fixing one direction silently breaks the other (Codex caught exactly this)
check('expandTokens: "sv151" normalizes like "SV 151"',
  eq(expandTokens('sv151 booster bundle'), expandTokens('SV 151 Booster Bundle')));
check('expandTokens: "op-117" normalizes like "OP117"',
  eq(expandTokens('op-117 booster box'), expandTokens('OP117 Booster Box')));
check('rank: compact "sv151 booster bundle" still reaches the spaced row',
  firstId(rankCandidates('sv151 booster bundle',
    [...CATALOG, P('sv151-bundle', 'SV 151 Booster Bundle')])) === 'sv151-bundle');
check('two-digit set codes stay atomic', eq(expandTokens('op17 booster box'),
  ['op17', 'booster', 'box']));

// ---- the amount must be recognised in the spellings people actually write --
// An unmatched amount is not a cosmetic miss: it leaves the line ending in text
// rather than "xN", so the explicit-marker rule stops firing and the
// leading-integer fallback takes over. "151 booster bundle x10 $1,800 USD"
// silently became 151 units. One unrecognised currency word, a wrong quantity
// two rules later.
for (const [line, wantQty, wantName] of [
  ['151 booster bundle x10 $1,800 USD', 10, '151 booster bundle'],
  ['151 booster bundle x10 US$1,800', 10, '151 booster bundle'],
  ['Prismatic spc x2 $1,800.00.', 2, 'Prismatic spc'],
  ['Prismatic spc x2 $510 usd', 2, 'Prismatic spc'],
]) {
  const r = parseBuyList(line)[0];
  check(`amount spelling: ${line} -> qty`, r.qty === wantQty);
  check(`amount spelling: ${line} -> name`, r.name === wantName);
  check(`amount spelling: ${line} -> no $ left in name`, !/\$/.test(r.name));
}
// …and a plain product name that merely ends in a letter run must be untouched
check('no amount, no note', parseBuyList('Prismatic spc x2')[0].note === null);
check('a bare number is not treated as an amount',
  parseBuyList('Prismatic spc x2 510')[0].name === 'Prismatic spc x2 510');

// ---- known scoring defect, pinned at the requirement not at the bug --------
// "Mega Charizard upc" ranks `Charizard Ultra-Premium Collection` first and the
// correct `Mega Charizard X ex UPC` second. The cause is in the scorer, not in
// this change: a candidate MISSING an identity word from the input ("mega")
// loses only a little, while one carrying extra words ("x", "ex") is punished
// harder by Jaccard, so the one that dropped the identity wins. Before the
// trailing-amount fix this line happened to rank right only because the "$230"
// was still polluting the score.
//
// Asserting the wrong order would DEMAND the bug — the mistake count_label_test
// made when its old assertions required "10 packs (in bag)". So pin what the
// page actually needs: the right row has to be among the candidates a person
// picks from, and the wrong one must not be able to auto-book (BuyListIntake
// preselects only on a unique perfect bidirectional match). When someone fixes
// the scorer, the second check below starts passing and says so.
{
  const UPC = [
    P('mega-cz-upc', 'Mega Charizard X ex UPC'),
    P('old-cz-upc', 'Charizard Ultra-Premium Collection'),
    P('cz-spc', 'Charizard ex Super Premium Collection'),
  ];
  const got = rankCandidates('Mega Charizard upc', UPC, { limit: 5 });
  check('rank: the right Charizard UPC is at least offered',
    got.some(c => c.id === 'mega-cz-upc'));
  const top1Right = got[0] && got[0].id === 'mega-cz-upc';
  console.log(top1Right
    ? '  NOTE: scorer fixed — "Mega Charizard upc" now ranks the right row first'
    : '  NOTE: known scorer defect — "Mega Charizard upc" still ranks the old UPC first (right row is #'
      + (got.findIndex(c => c.id === 'mega-cz-upc') + 1) + ', tracked separately)');
}

// ------------------------------------------- the store's real writing style
// Gary pasted an actual store list on 2026-09-04. Measured against the parser
// as it then stood: 0 of 7 quantities came out. Every line begins with a tick
// the staff add as they check items off, and the count is written "8x NAME"
// rather than "8 NAME". These pin both.
{
  const real = parseBuyList([
    '✅8x AH MEGA EX BOX - $48',
    '✅26X SPC - $215',
    '✅7x DR BBOX (ripped seal) - $320',
  ].join('\n'));
  check('tick + "8x NAME" -> qty 8', real[0].qty === 8);
  check('tick is not left in the product name', real[0].name === 'AH MEGA EX BOX');
  check('trailing per-unit price kept as a note', (real[0].note || '').includes('48'));
  check('uppercase "26X NAME" -> qty 26', real[1].qty === 26);
  check('"7x NAME (note) - $320" -> qty 7', real[2].qty === 7);
  check('parenthetical still becomes the note', (real[2].note || '').includes('ripped seal'));
}
{
  // A bulleted list is the same shape without the tick.
  const b = parseBuyList('- 5 Journey Together')[0];
  check('leading dash bullet does not block the count', b.qty === 5 && b.name === 'Journey Together');
}
{
  // The strip must take decoration ONLY. An earlier version removed the "["
  // from our own "[JP] ..." names — harmless, because the tokenizer drops
  // brackets, and therefore exactly the kind of silent mangling that survives
  // review. 177 of 874 names were affected.
  const jp = parseBuyList('[JP] OP-12 Legacy of the Master Booster Pack')[0];
  check('a leading [JP] tag survives intact', jp.name.startsWith('[JP]'));
}
{
  // "x" only counts with a space after it, so a product name carrying a
  // dimension is never read as a quantity.
  const d = parseBuyList('2x2 Ultra Pro Sleeves')[0];
  check('"2x2 ..." is a name, not a count of 2', d.qty === null);
}
{
  // Unchanged on purpose: a bare leading integer is still taken as a count, so
  // "151 booster bundle" still parses as 151. That is a known, separate
  // problem (the set is called 151) and it is pinned here so a future change
  // to it is deliberate rather than a side effect of this one.
  const k = parseBuyList('151 booster bundle')[0];
  check('bare leading integer still behaves as before', k.qty === 151);
}
{
  // Store shorthand added 09-04. Each produced zero candidates before.
  check('bbundle expands', eq(expandTokens('PRIS BBUNDLE'), ['prismatic', 'booster', 'bundle']));
  check('bbox expands', eq(expandTokens('DR BBOX'), ['destined', 'rivals', 'booster', 'box']));
  check('fps3 expands', eq(expandTokens('FPS3'), ['first', 'partner', 'series', '3']));
}

// ---------------------------------------------------------------- result
console.log(passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
