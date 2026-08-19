// Tests for appendSurplus — the real function, imported from api/lark-notify.js.
//
// Built from the 2026-08-12 21:31 PT Packheads card, which is what prompted the
// change: eight lines, one instruction ("record a Move"), repeated every
// session, one of them for the eleventh time. Most of them cannot be moved
// because no other room holds the goods.
//
//   node scratchpad/surplus_split_test.mjs

import { appendSurplus } from '../api/lark-notify.js'

let pass = 0
const fails = []
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log('  ok   ' + name) }
  else { fails.push(name); console.log('  FAIL ' + name + '  ' + detail) }
}

const daysAgo = n => new Date(Date.now() - n * 86400000).toISOString()

// The real card, with the classification measured against the live database.
const REAL = [
  { name: 'OP-16 Booster Pack', extra: 67, streak: 4, since: daysAgo(5),
    fixable: false, elsewhere: 0, sources: [] },
  { name: 'Hololive Ayakashi Vermillion', extra: 6, streak: 3, since: daysAgo(4),
    fixable: true, elsewhere: 59, sources: [{ name: 'Master Inventory', qty: 36 }, { name: 'RocketsHQ', qty: 23 }] },
  { name: 'Weiss Uma Musume', extra: 12, streak: 8, since: daysAgo(20),
    fixable: false, elsewhere: 0, sources: [] },
  { name: 'DBS Fusion World ST01', extra: 6, streak: 1, since: null,
    fixable: false, elsewhere: 0, sources: [] },
  { name: 'DB Masters Prismatic Clash', extra: 2, streak: 11, since: daysAgo(30),
    fixable: false, elsewhere: 0, sources: [] },
  { name: 'DanDaDan', extra: 1, streak: 3, since: daysAgo(6),
    fixable: false, elsewhere: 0, sources: [] },
  { name: 'FB03 Raging Roar', extra: 2, streak: 3, since: daysAgo(6),
    fixable: true, elsewhere: 25, sources: [{ name: 'RocketsHQ', qty: 12 }, { name: 'Master Inventory', qty: 8 }] },
  { name: 'Nivel Arena Epic Seven', extra: 1, streak: 8, since: daysAgo(21),
    fixable: true, elsewhere: 1, sources: [{ name: 'Master Inventory', qty: 1 }] }
]

const out = appendSurplus([], REAL, 97).join('\n')
console.log('\n--- rendered ---\n' + out + '\n----------------\n')

ok('总数还在', out.includes('+97 units'))
ok('分成两块', out.includes('✅ Fixable') && out.includes('No source anywhere'))
ok('可修的点名来源房间', out.includes('Master Inventory has 36'), out)
ok('可修的三条都在', ['Hololive', 'FB03', 'Epic Seven'].every(n => out.includes(n)))
ok('查无来路的不再被要求 Move',
   !out.split('No source anywhere')[1].includes('Record a Move'), out)
ok('明说别动库存', out.includes('Do NOT adjust stock'))

// The oldest must survive the cap — sorting by size is what buried it.
const unsourced = out.split('No source anywhere')[1]
ok('最老的那条露出来了(Prismatic Clash 连报 11 场)', unsourced.includes('Prismatic Clash'), unsourced)
ok('连报次数印出来', unsourced.includes('11 counts running'))
ok('挂了多久印出来', /open \d+d/.test(unsourced))
ok('超出上限的有交代,不能看起来像全部了',
   unsourced.includes('and 1 more') && /\+\d+ units\. Full list/.test(unsourced), unsourced)

// A failed lookup must not read as either bucket.
const UNCHECKED = [{ name: 'Something', extra: 5, streak: 2, since: null,
                     fixable: null, elsewhere: null, sources: [] }]
const u = appendSurplus([], UNCHECKED, 5).join('\n')
ok('查不到别房时不许说"可修"', !u.includes('Fixable now'), u)
ok('查不到别房时不许说"查无来路"', !u.includes('No source anywhere'), u)
ok('查不到就明说查不到', u.includes('Other rooms not checked'), u)
ok('并且要当成未解决', u.includes('unresolved, not fixable'))

// Degenerate inputs
ok('没有差异就不输出', appendSurplus([], [], 0).length === 0)
ok('全部可修时不印"查无来路"那块',
   !appendSurplus([], [REAL[1]], 6).join('\n').includes('No source anywhere'))
ok('全部查无来路时不印"可修"那块',
   !appendSurplus([], [REAL[0]], 67).join('\n').includes('Fixable now'))
ok('缺 since 不会印出 NaN', !appendSurplus([], [REAL[3]], 6).join('\n').includes('NaN'))

// The cap sorts by age, so the biggest can fall outside it. It must not:
// +67 of a +97 is the problem, and dropping it to make room for a +1 turns
// the message into a lie of omission.
const MANY = [
  { name: 'ancient tiny', extra: 1, streak: 9, since: daysAgo(60), fixable: false, elsewhere: 0, sources: [] },
  { name: 'old tiny', extra: 1, streak: 8, since: daysAgo(50), fixable: false, elsewhere: 0, sources: [] },
  { name: 'older tiny', extra: 1, streak: 7, since: daysAgo(40), fixable: false, elsewhere: 0, sources: [] },
  { name: 'stale tiny', extra: 1, streak: 6, since: daysAgo(30), fixable: false, elsewhere: 0, sources: [] },
  { name: 'stale tiny 2', extra: 1, streak: 5, since: daysAgo(25), fixable: false, elsewhere: 0, sources: [] },
  { name: 'THE BIG ONE', extra: 67, streak: 1, since: daysAgo(1), fixable: false, elsewhere: 0, sources: [] }
]
const m = appendSurplus([], MANY, 72).join('\n')
ok('最大的一条永远不会被上限挤掉', m.includes('THE BIG ONE'), m)
ok('最老的也还在', m.includes('ancient tiny'))
ok('被省略的仍然报数', /and 2 more, \+2 units/.test(m), m)

console.log(`\n${pass + fails.length} 个用例,${fails.length} 个失败`)
process.exit(fails.length ? 1 : 0)
