// Render the real 2026-08-18 21:49 PT Packheads count through the current builder.
import { appendSurplus, shortCountName, dominantLanguage } from '../api/lark-notify.js'
const L = (b,n,c,l) => `${b} | ${n} | ${c} | ${l}`
const soldItems = [
  { name: L('One Piece','[EN] OP-02 Paramount War','Booster Box','EN'), quantity: 1 },
  { name: L('One Piece','[EN] OP-13 Carrying On His Will','Blister Pack','EN'), quantity: 66 },
  { name: L('One Piece','[EN] OP-16 The Time Of Battle','Blister Pack','EN'), quantity: 65 },
  { name: L('One Piece','The Time of Battle Booster Pack - The Time of Battle (OP16)','Booster Pack','EN'), quantity: 55 },
  { name: L('Other','Lorcana Attack of the Vine Sleeves','Blister Pack','EN'), quantity: 69 },
  { name: L('Pokemon','OP-15 Kami’s Adventure','Booster Pack','EN'), quantity: 70 },
  { name: L('One Piece',"Adventure on Kami's Island Booster Pack - Adventure on Kami's Island (OP15-EB04)",'Booster Pack','EN'), quantity: 45 },
  { name: L('One Piece','[EN] One Piece: Premium Booster PRB2 Booster Packs','Booster Box','EN'), quantity: 2 },
  { name: L('Other','Dragon Ball Fusion World (Cross Force) FB10','Booster Pack','EN'), quantity: 1 },
  { name: L('Other','Limit Over Collection The Rivals','Booster Box','JP'), quantity: 1 },
]
const discrepancyItems = [
  { name: L('Other','Hololive: Ayakashi Vermillion','Booster Box','EN'), extra: 6, fixable: true,
    sources: [{name:'Master Inventory',qty:36},{name:'Stream Room - TikTok RocketsHQ',qty:12}] },
  { name: L('Other','Nivel Arena: Epic Seven','Booster Box','JP'), extra: 1, fixable: true,
    sources: [{name:'Master Inventory',qty:1}] },
  { name: L('Other','Dragon Ball Super Card Game Fusion World STORY BOOSTER 01 ST01','Booster Box','JP'),
    extra: 2, fixable: false, elsewhere: 0, streak: 1, since: '2026-08-18T00:00:00Z' },
  { name: L('One Piece','[JP] OP-13 Carrying On His Will','Booster Box','JP'),
    extra: 12, fixable: false, elsewhere: 0, streak: 1, since: '2026-08-18T00:00:00Z' },
]
const dominant = dominantLanguage(soldItems, discrepancyItems)
const lines = []
lines.push('📋 Stream Count — TikTok Packheads')
lines.push('Sold by Trey (last session) · counted by Trey (now streaming)')
lines.push('')
lines.push(`📤 Sold last session: 375 units / ${soldItems.length} SKUs`)
for (const i of [...soldItems].sort((a,b)=>b.quantity-a.quantity))
  lines.push(`  • ${shortCountName(i.name, dominant)} × ${i.quantity}`)
appendSurplus(lines, discrepancyItems, 21, dominant)
console.log(lines.join('\n'))
console.log(`\n--- ${lines.join('\n').length} chars (the old one was 1478) ---`)
