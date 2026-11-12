// node scratchpad/stock_zones_test.mjs   — the zone names of the page, the database and the plan rule agree (Will 11/11: Dragon Ball and One Piece zones)
import { readFileSync } from 'fs'
import { ZONES, ZONE_GROUPS, ZONE_PATTERN, STOCK_BRANDS, UNSORTED, STORE_ZONE, zoneMax, isBigZone, planZoneSubmit, zoneLabel, zoneState } from '../src/lib/stockCheck.js'

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { if (cond) pass++; else { fail++; console.log('FAIL', name, extra) } }

const re = new RegExp(ZONE_PATTERN)
ok('90 small zones', ZONES.length === 90, ZONES.length)
ok('no zone twice', new Set(ZONES).size === ZONES.length)
ok('the 50 Pokemon zones first, unchanged', ZONES.slice(0, 50).join() === 'ABCDEFGHIJ'.split('').flatMap(l => [1, 2, 3, 4, 5].map(n => l + n)).join())
ok('Dragon Ball 1-5', ['DB1', 'DB2', 'DB3', 'DB4', 'DB5'].every(z => ZONES.includes(z)))
for (const c of ['BLU', 'PUR', 'RED', 'GRN', 'YEL', 'BLK', 'LD']) ok(`One Piece ${c} 1-5`, [1, 2, 3, 4, 5].every(n => ZONES.includes(c + n)))
ok('every zone passes the pattern', [...ZONES, UNSORTED, STORE_ZONE].every(z => re.test(z)), [...ZONES].filter(z => !re.test(z)).join())
// the pattern lets in nothing the page does not have
const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')
const tries = [...letters.flatMap(a => [0, 1, 5, 6].map(n => a + n)), ...letters.flatMap(a => letters.flatMap(b => [0, 1, 5, 6].map(n => a + b + n))),
  ...['BLU', 'PUR', 'RED', 'GRN', 'YEL', 'BLK', 'BLUE', 'LDR', 'DON', 'OP', 'DBS'].flatMap(c => [0, 1, 5, 6, 11].map(n => c + n)), 'unsorted', 'store', 'Unsorted ', ' A1', 'A1 ', 'A11', 'DB1\n', '']
ok('the pattern lets in only the page zones', tries.filter(t => re.test(t)).every(t => ZONES.includes(t)), tries.filter(t => re.test(t) && !ZONES.includes(t)).join())
for (const f of ['scripts/stock_zones_games_migration.sql', 'scripts/create_stock_check_tables.sql']) {
  const found = [...readFileSync(new URL('../' + f, import.meta.url), 'utf8').matchAll(/zone ~ '([^']+)'/g)].map(m => m[1])
  ok(`${f} has the pattern twice`, found.length === 2 && found.every(p => p === ZONE_PATTERN), found.join(' | '))
}
ok('groups cover the zones in order', ZONE_GROUPS.flatMap(g => g.rows.flatMap(r => r.zones)).join() === ZONES.join())
ok('every row is five zones', ZONE_GROUPS.every(g => g.rows.every(r => r.zones.length === 5)))
ok('a new zone holds 120', zoneMax('BLU3') === 120 && zoneMax('DB1') === 120 && !isBigZone('LD5'))
ok('brands', STOCK_BRANDS.join() === 'Pokemon,One Piece,Dragon Ball Fusion World')

// the plan rule treats a new zone as any zone
const rows = new Map([['OP1', [{ id: 'r1', quantity: 4, status: 'in_inventory' }]], ['DB9', [{ id: 'r2', quantity: 2, status: 'in_inventory' }]], ['PK1', [{ id: 'r3', quantity: 3, status: 'in_inventory' }]]])
let p = planZoneSubmit({ submit: new Set(['BLU1']), scans: new Map([['BLU1|OP1', 4]]), ledger: new Map([['A1|PK1', { qty: 3, at: '2026-11-05' }]]), rows })
ok('first scan of a One Piece card equal to stock changes nothing', p.fixes.length === 0 && p.zeroed.length === 0 && p.raised.length === 0 && p.changes.get('OP1')?.[0]?.zone === 'BLU1' && p.changes.get('OP1')[0].qty === 4)
p = planZoneSubmit({ submit: new Set(['BLU1']), scans: new Map([['BLU1|OP1', 3]]), ledger: new Map(), rows })
ok('a part scan (3 of 4) lowers nothing: the rest may sit in a zone not scanned yet', p.fixes.length === 0 && p.zeroed.length === 0)
p = planZoneSubmit({ submit: new Set(['BLU1', 'DB1']), scans: new Map([['BLU1|OP1', 3], ['DB1|DB9', 2]]), ledger: new Map([['A1|PK1', { qty: 3, at: '2026-11-05' }]]), rows, finishing: true })
ok('finishing lists the copy no zone holds, and only that', p.zeroed.length === 1 && p.zeroed[0].id === 'OP1' && p.zeroed[0].to === 3 && p.fixes.length === 0)
p = planZoneSubmit({ submit: new Set(['RED2']), scans: new Map([['RED2|OP1', 6]]), ledger: new Map(), rows })
ok('more than stock is never added by itself', p.raised.length === 1 && p.holdUnlessTicked.has('OP1') && p.fixes.length === 0)
p = planZoneSubmit({ submit: new Set(['DB2']), scans: new Map([['DB2|XX', 1]]), ledger: new Map(), rows })
ok('a card of a game not checked is an extra, not changed', p.extras.length === 1 && p.fixes.length === 0)

// Will 11/12: zones written out on the page; the codes stay what is stored
ok('label: Blue 1', zoneLabel('BLU1') === 'Blue 1')
ok('label: Dragon Ball 5', zoneLabel('DB5') === 'Dragon Ball 5')
ok('label: Purple / Red / Green / Yellow / Black', ['PUR2', 'RED3', 'GRN4', 'YEL5', 'BLK1'].map(zoneLabel).join(',') === 'Purple 2,Red 3,Green 4,Yellow 5,Black 1')
ok('label: Leader + DON!! 3', zoneLabel('LD3') === 'Leader + DON!! 3')
ok('label: Pokemon zones as they are', zoneLabel('A1') === 'A1' && zoneLabel('J5') === 'J5')
ok('label: big zones', zoneLabel(UNSORTED).startsWith('Unsorted') && zoneLabel(STORE_ZONE).startsWith('Store'))
ok('every zone has a label, all different', new Set(ZONES.map(zoneLabel)).size === ZONES.length && ZONES.every(z => zoneLabel(z)))
ok('no label is a code of the pattern except Pokemon', ZONES.filter(z => new RegExp(ZONE_PATTERN).test(zoneLabel(z))).every(z => /^[A-J][1-5]$/.test(z)))
ok('state: finished = done', zoneState({ done: true, scanned: 0, held: 5 }) === 'done')
ok('state: nothing scanned, nothing recorded = empty', zoneState({ done: false, scanned: 0, held: 0 }) === 'empty')
ok('state: recorded, not finished = todo', zoneState({ done: false, scanned: 0, held: 3 }) === 'todo')
ok('state: scanned, not finished = todo', zoneState({ done: false, scanned: 2, held: 0 }) === 'todo')

console.log(`${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
