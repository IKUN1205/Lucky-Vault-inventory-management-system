// Singles sale-channel vocabulary (Gary 2026-07-29).
// Stored values MATCH platform_sales.channel + the CHANNEL_TO_STREAM_ROOM
// keys in supabase.js (the vocabulary SellSlabModal adopted 7/21), so
// per-room singles sales line up with slab / room reporting.
//   - 'in_person' stays the Front Store register value — it is the ONLY
//     channel fetchStorefrontDailySummary counts. Label renamed "Storefront".
//   - COMC removed and generic 'ebay' removed for singles: eBay sales must
//     be booked per account (SlabbiePatty / LuckyVaultUS). Historical rows
//     keep their old values; they just can't be picked for NEW sales.
//   - 'Whatnot' is the stored value for the PokeCasino room (rename 7/22 —
//     historical rows carry 'Whatnot', so the key stays).
export const SINGLES_CHANNEL_OPTIONS = [
  { value: 'in_person',        label: 'Storefront' },
  { value: 'PackHeadsTCG',     label: 'TikTok — Packheads' },
  { value: 'RocketsHQ',        label: 'TikTok — RocketsHQ' },
  { value: 'Whatnot',          label: 'Whatnot — PokeCasino' },
  { value: 'PokeAuctionHouse', label: 'PokeAuctionHouse (auction)' },
  { value: 'SlabbiePatty',     label: 'eBay — SlabbiePatty' },
  { value: 'LuckyVaultUS',     label: 'eBay — LuckyVaultUS' },
  { value: 'shows',            label: 'Card Show (Shows)' },
  { value: 'tcgplayer',        label: 'TCGplayer' },
  { value: 'trade_out',        label: 'Trade Out' },
  { value: 'other',            label: 'Other' },
]

// TCGplayer deep link for a singles row — tcg_id IS the TCGplayer product id
// (it's what the barcode scan reads). Returns null when the id isn't a plain
// number (custom/legacy codes) so callers render plain text instead of a 404.
export const tcgProductUrl = (tcgId) =>
  tcgId && /^\d+$/.test(String(tcgId))
    ? `https://www.tcgplayer.com/product/${tcgId}`
    : null
