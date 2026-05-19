# Singles reconcile dry-run — 2026-05-18

Source sheet: `scripts/_singles_latest_2026_05_18.csv` (225 unique tcg_ids)
DB now: 284 active raw singles with tcg_id

## Summary

| Action | Count |
|--------|-------|
| Insert (sheet only)      | 118 |
| Update qty (both differ) | 27 |
| Soft-delete (DB only)    | 177 |
| No change (both match)   | 80 |

## INSERT (sheet only — new cards to add)

| TCG ID | Name | Set | Qty |
|--------|------|-----|-----|
| 246714 | Lycanroc VMAX 213/203 Rainbow EVS | Evolving Skies | 1 |
| 664010 | Oricorio ex 024 MEP | Mega Evolution Promo | 1 |
| 219320 | Salamence VMAX 194/189 Rainbow DAA | Darkness Ablaze | 1 |
| 567474 | Galvantula ex 168/142 SIR SCR | Stellar Crown | 1 |
| 662222 | Rotom ex 126/094 SIR PFL | Phantasmal Flames | 1 |
| 284119 | Rotom V 177/196 Alt Art LOR | Lost Origin | 1 |
| 610532 | Teal Mask Ogerpon ex 177/131 HR PRE | Prismatic Evolutions | 1 |
| 542930 | Bianca's Devotion 209/162 SIR TEF | Temporal Forces | 1 |
| 560402 | Munkidori ex 091/064 SIR SFA | Shrouded Fable | 1 |
| 542933 | Salvatore 212/162 SIR TEF | Temporal Forces | 1 |
| 477181 | Hoopa V - SWSH: Crown Zenith: Galarian Gallery (CRZ:GG) GG53/GG70 | Unsorted / Promo | 1 |
| 490290 | Great Tusk ex 246/198 SIR SVI | Scarlet & Violet Base Set | 1 |
| 490097 | Penny 239/198 UR SVI | Scarlet & Violet Base Set | 2 |
| 165766 | Bonnie 128/131 FA SM06 | SM - Forbidden Light | 1 |
| 253284 | Flaaffy (Secret) 280/264 Rainbow SWSH08 | Fusion Strike | 1 |
| 610531 | Iron Leaves ex 176/131 HR PRE | SV: Prismatic Evolutions | 2 |
| 284272 | Orbeetle V TG12/TG30 UR SWSH11: TG | Lost Origin Trainer Gallery | 1 |
| 284294 | Eternatus V TG21/TG30 UR SWSH11: TG | Lost Origin Trainer Gallery | 1 |
| 88467 | Quagsire 030/147 AQ | Aquapolis | 1 |
| 589925 | Drayton 244/191 SIR SSP | Surging Sparks | 1 |
| 452018 | Jynx TG04/TG30 UR SWSH12: TG | Silver Tempest Trainer Gallery | 1 |
| 478043 | Miltank GG24/GG70 UR CRZ:GG | SWSH: Crown Zenith: Galarian Gallery | 1 |
| 284268 | Hisuian Arcanine TG08/TG30 UR SWSH11: TG | Lost Origin Trainer Gallery | 1 |
| 654492 | Gumshoos 153/132 IR MEG | ME01: Mega Evolution | 1 |
| 567431 | Crabominable 149/142 IR SCR | Stellar Crown | 1 |
| 523878 | Espathra 197/182 IR PAR | Paradox Rift | 1 |
| 676062 | Fan Rotom 250/217 IR ASC | Ascended Heroes | 1 |
| 478045 | Riolu - SWSH: Crown Zenith: Galarian Gallery (CRZ:GG) GG26/GG70 CRZ:GG | Unsorted / Promo | 2 |
| 542889 | Snom 168/162 IR TEF | Temporal Forces | 1 |
| 552785 | Teal Mask Ogerpon 123 Promo SVP | SV: Scarlet & Violet Promo Cards | 2 |
| 578812 | Noctowl 141 (Pokemon Center Exclusive) Promo SVP | SV: Scarlet & Violet Promo Cards | 1 |
| 497630 | Flamigo 227/193 IR PAL | Paldea Evolved | 2 |
| 478025 | Electivire - SWSH: Crown Zenith: Galarian Gallery (CRZ:GG) GG08/GG70 | Unsorted / Promo | 1 |
| 452021 | Rockruff - SWSH12: Silver Tempest Trainer Gallery (SWSH12: TG) TG07/TG30 | Unsorted / Promo | 1 |
| 96006 | Kingdra (Alpha) 108/160 Holo Rare PRC | XY - Primal Clash | 1 |
| 567436 | Meditite 153/142 IR SCR | Stellar Crown | 1 |
| 523894 | Swablu 213/182 IR PAR | Paradox Rift | 1 |
| 523893 | Loudred 212/182 IR PAR | Paradox Rift | 1 |
| 201348 | Torkoal 237/236 Rainbow SM12 | SM - Cosmic Eclipse | 1 |
| 201355 | Gallade 244/236 Rainbow SM12 | SM - Cosmic Eclipse | 1 |
| 642555 | Simipour 102/086 IR BLK | Black Bolt | 1 |
| 523886 | Yveltal 205/182 IR PAR | Paradox Rift | 1 |
| 590003 | Mesprit 204/191 IR SSP | Surging Sparks | 1 |
| 487060 | Dondozo 207/198 IR SVI | Scarlet & Violet Base Set | 1 |
| 676037 | Scorbunny 225/217 IR ASC | Ascended Heroes | 2 |
| 523885 | Garbodor 204/182 IR PAR | Paradox Rift | 1 |
| 490719 | Miraidon 013 SVP | Scarlet & Violet Promo Cards | 1 |
| 642597 | Bisharp 143/086 IR BLK | Black Bolt | 1 |
| 250324 | Rocket's Zapdos 15/132 Classic Collection CCC | Classic Collection | 1 |
| 490063 | Armarouge 203/198 IR SVI | Scarlet & Violet Base Set | 1 |
| ... | (68 more) | | |

## UPDATE qty (both exist, quantity differs)

| TCG ID | Name | Old qty | → New qty | Δ |
|--------|------|---------|-----------|---|
| 676105 | Surfer | 4 | 2 | -2 |
| 542925 | Gouging Fire ex | 1 | 2 | +1 |
| 662150 | Dawn | 3 | 1 | -2 |
| 535108 | Penny | 2 | 4 | +2 |
| 497680 | Chien-Pao ex | 1 | 2 | +1 |
| 654522 | Acerola's Mischief | 4 | 2 | -2 |
| 165725 | 73/131 SM06 | 1 | 2 | +1 |
| 676069 | Canari | 1 | 3 | +2 |
| 623616 | N's Zoroark ex | 2 | 1 | -1 |
| 497678 | Chi-Yu ex | 2 | 1 | -1 |
| 654524 | Lt. Surge's Bargain | 2 | 3 | +1 |
| 610528 | Janine's Secret Art | 1 | 2 | +1 |
| 535095 | Arven | 2 | 1 | -1 |
| 642600 | Fraxure | 2 | 1 | -1 |
| 646169 | Victini | 2 | 4 | +2 |
| 490080 | Skwovet | 2 | 3 | +1 |
| 642251 | Scraggy | 1 | 2 | +1 |
| 642552 | Larvesta | 4 | 2 | -2 |
| 497622 | Sudowoodo | 1 | 2 | +1 |
| 676057 | Galarian Obstagoon | 2 | 3 | +1 |
| 208265 | Galarian Perrserker | 1 | 2 | +1 |
| 610496 | Ortega | 1 | 2 | +1 |
| 517176 | Erika's Invitation | 2 | 1 | -1 |
| 610687 | Duraludon (Master Ball Pattern) | 2 | 1 | -1 |
| 662224 | Sacred Charm | 2 | 5 | +3 |
| 633037 | Team Rocket's Ariana | 5 | 3 | -2 |
| 610643 | Whimsicott (Master Ball Pattern) | 1 | 2 | +1 |

## SOFT-DELETE (DB only — not in 2026-05-18 sheet)

| TCG ID | Name | Set | DB qty |
|--------|------|-----|--------|
| 101516 | Lugia EX (94 Full Art) | Ancient Origins | 1 |
| 108614 | Pikachu EX XY84 PR | XY84 - XY Promos | 1 |
| 124117 | Pidgeot EX | Evolutions | 1 |
| 127138 | Magearna XY186 TCG PR | XY186 - XY Promos | 1 |
| 131059 | Field Blower | SM - Guardians Rising | 1 |
| 131698 | Zygarde EX | 54a/124 - Alternate Art Promos | 1 |
| 138496 | Charizard GX | Burning Shadows | 1 |
| 138610 | Guzma | SM - Burning Shadows | 1 |
| 138635 | Fire Energy | SM - Burning Shadows | 1 |
| 149149 | Water Energy | SM - Crimson Invasion | 1 |
| 162460 | Dawn Wings Necrozma GX SM101 SMP | SM101 - SM Promos | 1 |
| 178857 | Blacephalon GX | SM - Lost Thunder | 1 |
| 197827 | Kartana GX - Hidden Fates: Shiny Vault (HIF:SV) | Unsorted / Promo | 1 |
| 201139 | Vileplume GX | SM - Cosmic Eclipse | 1 |
| 208365 | Lapras VMAX | Sword & Shield Base Set | 1 |
| 208381 | Morpeko VMAX | Sword & Shield Base Set | 1 |
| 208459 | Snorlax VMAX | Sword & Shield Base Set | 1 |
| 213256 | Boss's Orders | Rebel Clash | 1 |
| 226525 | Nessa | Vivid Voltage | 1 |
| 232395 | Yamper | Shiny Vault | 1 |
| 234093 | Rapid Strike Urshifu VMAX | Battle Styles | 1 |
| 241656 | Celebi VMAX | Chilling Reign | 1 |
| 241671 | Blaziken VMAX | Chilling Reign | 1 |
| 241699 | Ice Rider Calyrex V | Chilling Reign | 1 |
| 241702 | Ice Rider Calyrex VMAX | Chilling Reign | 1 |
| 241747 | Galarian Zapdos V | Chilling Reign | 1 |
| 241805 | Tornadus V | Chilling Reign | 1 |
| 241822 | Caitlin | Chilling Reign | 1 |
| 246746 | Glaceon V | Evolving Skies | 1 |
| 246752 | Duraludon VMAX | Evolving Skies | 1 |
| 246812 | Metal Energy | Evolving Skies | 1 |
| 253157 | Greedent V | Fusion Strike | 1 |
| 264218 | Eevee - | Unsorted / Promo | 1 |
| 272448 | Machamp VMAX | Astral Radiance | 1 |
| 272468 | Path to the Peak | Astral Radiance | 1 |
| 272478 | Falinks - | Unsorted / Promo | 1 |
| 282797 | Armaldo | 1/100 (Prerelease) - Miscellaneous Cards & Products | 1 |
| 284158 | Hisuian Zoroark VSTAR | Lost Origin | 1 |
| 284267 | Banette - | Unsorted / Promo | 1 |
| 451398 | Zeraora V - | Unsorted / Promo | 1 |
| 452017 | Flaaffy - | Unsorted / Promo | 1 |
| 46475 | Primeape | Southern Islands | 1 |
| 475643 | Bibarel - SWSH: Crown Zenith: Galarian Gallery (CRZ:GG) | Unsorted / Promo | 1 |
| 477049 | Lapras - SWSH: Crown Zenith: Galarian Gallery (CRZ:GG) | Unsorted / Promo | 1 |
| 478041 | Dunsparce - SWSH: Crown Zenith: Galarian Gallery (CRZ:GG) | Unsorted / Promo | 1 |
| 478059 | Turtwig - SWSH: Crown Zenith: Galarian Gallery (CRZ:GG) | Unsorted / Promo | 1 |
| 478066 | Simisear VSTAR - SWSH: Crown Zenith: Galarian Gallery (CRZ:GG) | Unsorted / Promo | 1 |
| 478093 | Melony - SWSH: Crown Zenith: Galarian Gallery (CRZ:GG) | Unsorted / Promo | 2 |
| 478423 | Pikachu V | Sword & Shield Promo Cards | 1 |
| 487086 | Fidough | Scarlet & Violet Base Set | 1 |
| 490066 | Clauncher | Scarlet & Violet Base Set | 1 |
| 490074 | Riolu | Scarlet & Violet Base Set | 1 |
| 497598 | Tropius | Paldea Evolved | 1 |
| 497603 | Pyroar | Paldea Evolved | 1 |
| 497607 | Marill | Paldea Evolved | 1 |
| 497617 | Sandygast | Paldea Evolved | 1 |
| 497618 | Rabsca | Paldea Evolved | 1 |
| 509944 | Gloom | Obsidian Flames | 1 |
| 509952 | Scizor | Obsidian Flames | 1 |
| 509957 | Lechonk | Obsidian Flames | 1 |
| 509983 | Pidgeot ex | Obsidian Flames | 1 |
| 509990 | Artazon | Obsidian Flames | 1 |
| 517016 | Caterpie | Scarlet & Violet 151 | 1 |
| 517023 | Jynx ex | Scarlet & Violet 151 | 1 |
| 517024 | Kangaskhan ex | Scarlet & Violet 151 | 1 |
| 517029 | Nidoking | Scarlet & Violet 151 | 1 |
| 517034 | Poliwhirl | Scarlet & Violet 151 | 1 |
| 517053 | Basic Psychic Energy | Scarlet & Violet 151 | 4 |
| 523876 | Blitzle | Paradox Rift | 1 |
| 523877 | Joltik | Paradox Rift | 1 |
| 523887 | Morpeko | Paradox Rift | 1 |
| 523927 | Golisopod ex | Paradox Rift | 1 |
| 523928 | Tapu Koko ex | Paradox Rift | 1 |
| 534462 | Vileplume | Paldean Fates | 1 |
| 534522 | Pikachu | Paldean Fates | 1 |
| 534683 | Mimikyu -160/091 | Paldean Fates | 1 |
| 535174 | Jigglypuff | Paldean Fates | 1 |
| 535303 | Espathra ex | Paldean Fates | 1 |
| 542887 | Sawsbuck | Temporal Forces | 1 |
| 550225 | Hisuian Growlithe | Twilight Masquerade | 1 |
| 550234 | Teal Mask Ogerpon ex | Twilight Masquerade | 1 |
| 550240 | Iron Thorns ex | Twilight Masquerade | 1 |
| 550262 | Kieran | Twilight Masquerade | 1 |
| 560376 | Tapu Bulu | Shrouded Fable | 1 |
| 560377 | Houndoom | Shrouded Fable | 1 |
| 560378 | Horsea | Shrouded Fable | 2 |
| 560385 | Okidogi | Shrouded Fable | 1 |
| 560388 | Fraxure | Shrouded Fable | 1 |
| 560408 | Powerglass | Shrouded Fable | 1 |
| 567421 | Lileep | Stellar Crown | 1 |
| 567448 | Lapras ex | Stellar Crown | 1 |
| 567465 | Crispin | Stellar Crown | 1 |
| 589865 | Appletun | Surging Sparks | 1 |
| 589868 | Archaludon ex | Surging Sparks | 1 |
| 589891 | Ceruledge | Surging Sparks | 1 |
| 589941 | Exeggcute | Surging Sparks | 1 |
| 589987 | Latios | Surging Sparks | 2 |
| 589990 | Lisia's Appeal | Surging Sparks | 1 |
| 590052 | Skarmory | Surging Sparks | 1 |
| 593855 | Alolan Exeggutor ex | Surging Sparks | 1 |
| ... | (77 more) | | |
