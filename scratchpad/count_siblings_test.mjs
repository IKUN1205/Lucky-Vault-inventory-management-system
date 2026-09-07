// Tests for the pack-sibling rule, run against the real module.
// Half of these check when it must stay QUIET: a wrong sibling routes a pack
// count onto somebody else's SKU, which is worse than leaving the row off.
import {
  tokens, language, isPackForm, isBreakableBox, findPackSibling, packSiblingRows,
} from '../src/lib/countSiblings.js'

let pass = 0, fail = 0
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ok   ' + name) }
  else { fail++; console.log('  FAIL ' + name); if (extra) console.log('       ' + extra) }
}

// ---- real rows, copied from production on 2026-09-06 ----------------------
const BOX_MARVEL = { id: 'b9edd8ba', name: 'BOX (32 packs) · 2023 Upper Deck Marvel Allegiance Infinity Trilogy', breakable: true, packs_per_box: 32, type: 'Sealed' }
const PACK_MARVEL = { id: '773a95c5', name: 'LOOSE PACK (singles) · 2023 Upper Deck Marvel Allegiance', type: 'Pack' }
const BOX_MXL = { id: 'eac57e70', name: '2024 Upper Deck Marvel Masterpieces XL Hobby Pack Booster Box', breakable: true, packs_per_box: 20, type: 'Sealed' }
const BOX_OP15_EN = { id: 'aaaa', name: 'BOX · [EN] OP-15 Adventure On Kami\'s Island', breakable: true, packs_per_box: 24, type: 'Sealed' }
const PACK_OP15_EN = { id: 'bbbb', name: 'LOOSE PACK · [EN] OP-15 Adventure On Kami\'s Island', type: 'Pack' }
const PACK_OP15_JP = { id: 'cccc', name: '[JP] OP-15 Adventure on Kami\'s Island Booster Pack', type: 'Pack' }
const BOX_NOBREAK = { id: 'dddd', name: 'Gem Pack Vol 6 Booster Box', breakable: false, packs_per_box: null, type: 'Sealed' }
const PACK_RETIRED = { id: 'eeee', name: 'LOOSE PACK (singles) · 2023 Upper Deck Marvel Allegiance', type: 'Pack', active: false }

const ALL = [PACK_MARVEL, PACK_OP15_EN, PACK_OP15_JP]

console.log('--- identity helpers ---')
ok('语言读得出来', language('BOX · [EN] OP-15') === 'EN')
ok('没写语言时是 null,不是"相同"', language('Gem Pack Vol 6 Booster Box') === null)
ok('包装词不参与身份', !tokens('Marvel Allegiance Booster Box').has('box'))
ok('年份留着当身份', tokens('2023 Upper Deck Marvel').has('2023'))
ok('Pack 型认得出来', isPackForm(PACK_MARVEL) && !isPackForm(BOX_MARVEL))
ok('不可拆的盒不算', !isBreakableBox(BOX_NOBREAK) && isBreakableBox(BOX_MARVEL))

console.log('--- 该配上的 ---')
ok('Marvel 盒配到 Marvel 散包', findPackSibling(BOX_MARVEL, ALL)?.id === '773a95c5')
ok('[EN] OP-15 盒配到 [EN] 散包', findPackSibling(BOX_OP15_EN, ALL)?.id === 'bbbb')

console.log('--- 必须闭嘴的 ---')
// This exact pair produced a false match before the year guard existed.
ok('2024 Masterpieces 不许配到 2023 Allegiance 的包',
   findPackSibling(BOX_MXL, [PACK_MARVEL]) === null,
   String(findPackSibling(BOX_MXL, [PACK_MARVEL])?.name))
ok('[EN] 盒不许配到 [JP] 包', findPackSibling(BOX_OP15_EN, [PACK_OP15_JP]) === null)
ok('没有候选就返回 null', findPackSibling(BOX_MARVEL, []) === null)
ok('停用的散包行不算候选', findPackSibling(BOX_MARVEL, [PACK_RETIRED]) === null)
ok('名字为空不炸也不配', findPackSibling({ id: 'x', name: '' }, ALL) === null)
ok('只重合一个词不算数',
   findPackSibling({ id: 'y', name: 'Marvel Something Else Entirely 2023', breakable: true, packs_per_box: 5 },
                   [{ id: 'z', name: 'Marvel Unrelated Booster Pack', type: 'Pack' }]) === null)

console.log('--- packSiblingRows ---')
const mk = (sib, from) => ({ product_id: sib.id, quantity: 0, product: sib, sibling_of: from.product?.name })
const rows = [{ product_id: 'b9edd8ba', quantity: 1, product: BOX_MARVEL }]
let add = packSiblingRows(rows, ALL, mk)
ok('给盒补一行散包', add.length === 1 && add[0].product_id === '773a95c5')
ok('补出来的是 0 件', add[0].quantity === 0)
ok('说明它为什么在表上', String(add[0].sibling_of).includes('Marvel Allegiance'))

const withPack = [...rows, { product_id: '773a95c5', quantity: 4, product: PACK_MARVEL }]
ok('散包已经在表上就不重复加', packSiblingRows(withPack, ALL, mk).length === 0)

const twoBoxes = [
  { product_id: 'b9edd8ba', quantity: 1, product: BOX_MARVEL },
  { product_id: 'b9edd8bZ', quantity: 2, product: { ...BOX_MARVEL, id: 'b9edd8bZ' } },
]
ok('两个盒共用一个散包兄弟时只加一行',
   packSiblingRows(twoBoxes, ALL, mk).length === 1)

ok('不可拆的盒不拖任何东西上表',
   packSiblingRows([{ product_id: 'dddd', quantity: 5, product: BOX_NOBREAK }], ALL, mk).length === 0)
ok('空表返回空', packSiblingRows([], ALL, mk).length === 0)
ok('原来的行一个都没被改动', rows.length === 1 && rows[0].quantity === 1)

// Mutation check: the function must never remove or reorder what it was given.
const before = JSON.stringify(withPack)
packSiblingRows(withPack, ALL, mk)
ok('输入没有被就地改动', JSON.stringify(withPack) === before)

console.log(`\n${pass + fail} 个用例,${fail} 个失败`)
process.exit(fail ? 1 : 0)
