// Tests for src/lib/countCategories.js — runs the REAL function.
// Every name below is a real catalog row (2026-08-21 calibration pull), not an
// invented fixture. node scratchpad/count_categories_test.mjs
import { pathToFileURL } from 'url'
const { categoryOf, categoryRank, CATEGORY_ORDER } =
  await import(new URL('../src/lib/countCategories.js', import.meta.url).href)

let fail = 0
function check(label, cond, extra = '') {
  if (cond) console.log('  ok   ' + label)
  else { console.log('  FAIL ' + label + '  ' + extra); fail++ }
}

const CASES = [
  // one piece — incl. the brand-mislabeled Kami SKU (name must beat brand)
  ['[EN] OP-16 Booster Pack', 'onepiece'],
  ['[JP] OP-13 Carrying On His Will Booster Box', 'onepiece'],
  ['OP Illustration Box Vol. 6 Collection', 'onepiece'],
  [{ name: "[EN] OP-15 Adventure On Kami's Island Booster Pack", brand: 'Pokemon' }, 'onepiece'],
  ['One Piece Card Game Mini-tin Set Vol.3', 'onepiece'],
  ["One Piece-THE AZURE SEA'S SEVEN- Booster Box", 'onepiece'],
  // dragon ball — FB codes with and without the words "dragon ball"
  ['Dragon Ball Fusion World (Cross Force) FB10 Booster Pack', 'dragonball'],
  ['FB03 Dragon Ball Supor Card Game Raging Roar Booster Box', 'dragonball'],
  ['DRAGON BALL Card Game Masters Prismatic Clash Booster Box', 'dragonball'],
  // weiss
  ['Weiss Schwarz Uma Musume Pretty Derby Booster Box', 'weiss'],
  ['Weiss Schwarz Blue Archive The Animation Booster Box', 'weiss'],
  // marvel / upper deck
  ['2023 Upper Deck Marvel Allegiance The Infinity Trilogy Hobby Box', 'marvel'],
  ['2024 Upper Deck Marvel Masterpieces XL Hobby Pack Booster Box', 'marvel'],
  ['2025 Cosmos Marvel Hobby Box', 'marvel'],
  // lorcana / hololive / gundam
  ['Lorcana Attack of the Vine Sleeves Blister Pack', 'lorcana'],
  ['Hololive: Ayakashi Vermillion Booster Box', 'hololive'],
  ['hololive Enchant Regalia Booster Pack', 'hololive'],
  ['Freedom Ascension Sleeved Booster Pack - Freedom Ascension (GD05)', 'gundam'],
  // pokemon — EN sets, JP M-series sets (no "pokemon" in the name), CN, fire buckets
  ['Journey Together Booster Pack', 'pokemon'],
  ['Storm Emeralda Booster Box', 'pokemon'],
  ['Storm Emeralda (In Bag)', 'pokemon'],
  ['Abyss Eye Booster Box Japanese', 'pokemon'],
  ['Gem Vol.4 Booster Box', 'pokemon'],
  ['Prismatic Evolutions Booster Pack', 'pokemon'],
  ['m4（fire） Single Pack', 'pokemon'],
  ['m2a（fire） Single Pack', 'pokemon'],
  ['[CN] Pokemon 5.0 Poke Ball', 'pokemon'],
  // yugioh — the JP Rarity Collection saga must NOT land in pokemon;
  // Limit Over / Ghost from the Past carry brand=Other in the DB (Codex 8/21)
  ['[JP] Rarity Collection Quarter Century Booster Box', 'yugioh'],
  [{ name: 'Limit Over Collection Heroes Booster Box', brand: 'Other' }, 'yugioh'],
  [{ name: 'Limit Over Collection The Rivals Booster Box', brand: 'Other' }, 'yugioh'],
  [{ name: 'Ghost from the Past Booster Box', brand: 'Other' }, 'yugioh'],
  // other — and the near-miss traps
  ['Azuki Gates Awakened Booster Box', 'other'],
  ['DanDaDan Booster Box Booster Box', 'other'],
  ['Nivel Arena: Epic Seven Booster Box', 'other'],
  ['Palworld: Dawn of Palpagos Booster Box', 'other'],
  ['Penny Sleeves Other', 'other'],
  ['Top Loaders Other', 'other'],           // "Top" must not hit the OP rule
  ['Topps 2026 Series 1 Baseball Box', 'other'],
  ['Big Into Energy Blind Box (Labubu)', 'other'],
  ['Magic: The Gathering Final Fantasy Commander Deck', 'other'],
]

for (const [input, want] of CASES) {
  const got = categoryOf(input)
  const label = (typeof input === 'string' ? input : input.name).slice(0, 52)
  check(`${label} -> ${want}`, got === want, `got ${got}`)
}

// contract bits the page relies on
check('bare string input works', categoryOf('[EN] OP-02 Paramount War Booster Box') === 'onepiece')
check('null product -> other', categoryOf(null) === 'other')
check('empty name + unknown brand -> other', categoryOf({ name: '', brand: 'Sports' }) === 'other')
check('brand fallback still works when the name says nothing',
  categoryOf({ name: 'Booster Box', brand: 'One Piece' }) === 'onepiece')
check('one piece sorts before pokemon', categoryRank('onepiece') < categoryRank('pokemon'))
check('other sorts last', CATEGORY_ORDER[CATEGORY_ORDER.length - 1].key === 'other')
check('unknown key ranks as other', categoryRank('nonsense') === categoryRank('other'))

console.log(fail ? `\nFAILURES: ${fail}` : '\nALL PASS')
process.exit(fail ? 1 : 0)
