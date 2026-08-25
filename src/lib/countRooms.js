// Which rooms on the blind-count page are LEDGER rooms — rooms whose sales are
// already recorded elsewhere in real time (Front Store: every POS sale
// decrements inventory; Master: no sales at all). A negative count diff there
// is unexplained shortfall, NEVER "sold".
//
// Gary 2026-08-24 ("做一个点货和直播间一样"): Front Store and Master count on
// the same blind page as the stream rooms, so every consumer that turns
// stream_counts negative diffs into a sales number MUST exclude these rooms —
// otherwise store shrinkage double-counts on top of storefront_sales and
// Master shortfall becomes sales out of thin air (Codex 2026-08-24 P1).
//
// Single source of truth: api/lark-notify.js and every report import this.
export function isLedgerRoomName(name) {
  const n = String(name || '').toLowerCase()
  return n.includes('front store') || n.includes('master inventory')
}
