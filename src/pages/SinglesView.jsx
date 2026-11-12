import React, { useEffect, useMemo, useState } from 'react'
import { Layers, Loader2, RefreshCw } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { ToastContainer, useToast } from '../components/Toast'
import { STOCK_BRANDS, UNSORTED, ZONES, ZONE_GROUPS, dayOf, zoneLabel } from '../lib/stockCheck'

// Singles Inventory (Gary 2026-11-05「每个分区的库和门店的库list ... 给他一个singles view inventory 做在stockcheck 下面」). Read only.
// A zone lists what its last scan recorded: a sale does not change that until the next scan, so each line also shows the stock now.
// Storefront lists the stock there. No zone lists Inventory copies no zone records.

const PAGE = 1000
const INVENTORY_ROOM = '6d89a23e-c250-4dcd-81cf-2b4dd26c7592'
const STORE_ROOM = 'c4cf3dab-94d7-4c2c-a4b4-214977feec06'
const STOREFRONT = 'Storefront'
const NO_ZONE = 'No zone'

async function readAllPages(build) {
  const all = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build().range(from, from + PAGE - 1)
    if (error) throw error
    all.push(...(data || []))
    if (!data || data.length < PAGE) return all
  }
}

const cardName = (r) => [r.card_name, r.card_number, r.language === 'EN' ? '' : r.language].filter(Boolean).join(' ')

export default function SinglesView() {
  const { toasts, addToast, removeToast } = useToast()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [picked, setPicked] = useState(STOREFRONT)
  const [filter, setFilter] = useState('')

  const load = async () => {
    setLoading(true)
    try {
      const [rows, ledger] = await Promise.all([
        readAllPages(() => supabase.from('singles')
          .select('tcg_id, card_name, card_number, language, quantity, location_id, set:card_sets(name)')
          .in('location_id', [INVENTORY_ROOM, STORE_ROOM]).in('brand', STOCK_BRANDS).neq('status', 'sold').eq('deleted', false)
          .gt('quantity', 0).not('tcg_id', 'is', null).order('id')),
        readAllPages(() => supabase.from('stock_zone_qty').select('zone, tcg_id, qty, scanned_at').eq('location_id', INVENTORY_ROOM).order('zone').order('tcg_id')),
      ])
      const cards = new Map()
      const card = (id) => { if (!cards.has(id)) cards.set(id, { id, name: '', set: '', inv: 0, store: 0 }); return cards.get(id) }
      for (const r of rows) {
        const c = card(String(r.tcg_id))
        if (!c.name) { c.name = cardName(r); c.set = r.set?.name || '' }
        if (r.location_id === INVENTORY_ROOM) c.inv += Number(r.quantity) || 0
        else c.store += Number(r.quantity) || 0
      }
      // Zone records of cards with no stock now: their names come from their other rows.
      const nameless = [...new Set(ledger.map(l => String(l.tcg_id)).filter(id => !cards.get(id)?.name))]
      for (let i = 0; i < nameless.length; i += 100) {
        const old = await readAllPages(() => supabase.from('singles')
          .select('tcg_id, card_name, card_number, language, set:card_sets(name)')
          .in('tcg_id', nameless.slice(i, i + 100)).eq('deleted', false).order('id'))
        for (const r of old) {
          const c = card(String(r.tcg_id))
          if (!c.name) { c.name = cardName(r); c.set = r.set?.name || '' }
        }
      }
      // A scan can record a card with no stock row at all: it still gets a line.
      for (const l of ledger) card(String(l.tcg_id))
      setData({ cards, ledger })
    } catch (err) {
      addToast(`Could not load: ${err.message}`, 'error')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const lists = useMemo(() => {
    const out = new Map([...ZONES, UNSORTED, NO_ZONE, STOREFRONT].map(z => [z, []]))
    if (!data) return out
    const inZones = new Map()
    for (const l of data.ledger) {
      const id = String(l.tcg_id)
      inZones.set(id, (inZones.get(id) || 0) + (Number(l.qty) || 0))
      if (out.has(l.zone)) out.get(l.zone).push({ ...data.cards.get(id), here: Number(l.qty) || 0, at: l.scanned_at })
    }
    for (const c of data.cards.values()) {
      if (c.store > 0) out.get(STOREFRONT).push({ ...c, here: c.store })
      const spare = c.inv - (inZones.get(c.id) || 0)
      if (spare > 0) out.get(NO_ZONE).push({ ...c, here: spare })
    }
    for (const list of out.values()) list.sort((a, b) => (a.name || '').localeCompare(b.name || ''))
    return out
  }, [data])

  const copies = (z) => (lists.get(z) || []).reduce((s, l) => s + l.here, 0)
  const term = filter.trim().toLowerCase()
  const shown = (lists.get(picked) || []).filter(l => !term || (l.name || '').toLowerCase().includes(term) || l.id.includes(term) || (l.set || '').toLowerCase().includes(term))
  const totals = useMemo(() => {
    let inv = 0, store = 0
    if (data) for (const c of data.cards.values()) { inv += c.inv; store += c.store }
    return { inv, store }
  }, [data])

  const tile = (z, label, extra = '') => (
    <button
      key={z}
      type="button"
      data-testid={`tile-${z}`}
      onClick={() => setPicked(z)}
      className={`px-2 py-1.5 rounded-md border text-left ${picked === z ? 'border-vault-gold bg-vault-gold/15 text-white' : 'border-vault-border text-gray-300 hover:border-vault-gold/50'} ${extra}`}
    >
      <div className="text-xs font-semibold">{label}</div>
      <div className="text-xs text-gray-400 tabular-nums">{copies(z)}</div>
    </button>
  )

  return (
    <div>
      <ToastContainer toasts={toasts} removeToast={removeToast} />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="font-display text-2xl font-bold text-white flex items-center gap-3"><Layers className="text-vault-gold" /> Singles Inventory / 单卡库存</h1>
          <p className="text-gray-400 mt-1 text-sm" data-testid="singles-totals">Pokemon, One Piece and Dragon Ball singles. Inventory / 后面 {totals.inv} · Storefront / 门店 {totals.store}. A zone shows its last scan; a sale changes it at the next scan.<br />分区显示最后一次扫的记录，卖掉的卡等下次扫才变，所以每行也写现在的库存。</p>
        </div>
        <button type="button" onClick={load} disabled={loading} className="btn btn-secondary px-3 flex items-center gap-1 text-sm">
          {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Refresh
        </button>
      </div>

      <div className="card mb-4">
        <div className="flex flex-wrap gap-2 mb-2">
          {tile(STOREFRONT, 'Storefront / 门店', 'min-w-[130px]')}
          {tile(UNSORTED, 'Unsorted', 'min-w-[90px]')}
          {tile(NO_ZONE, 'No zone / 没分区', 'min-w-[110px]')}
        </div>
        {ZONE_GROUPS.map(g => (
          <div key={g.name} className="mb-2">
            <div className="text-xs font-semibold text-vault-gold mb-1">{g.name}</div>
            <div className="grid grid-cols-5 gap-1.5" data-testid="zone-grid">
              {g.rows.flatMap(r => r.zones).map(z => tile(z, zoneLabel(z)))}
            </div>
          </div>
        ))}
      </div>

      <div className="card">
        <div className="flex flex-wrap items-center gap-2 mb-2">
          <div className="text-sm font-semibold text-white" data-testid="picked-title">{ZONES.includes(picked) ? zoneLabel(picked) : picked}: {shown.length} cards, {shown.reduce((s, l) => s + l.here, 0)} copies</div>
          <input type="text" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter: name, id or set / 筛选" className="flex-1 min-w-[180px] px-3 py-1.5 text-sm" />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs" data-testid="singles-list">
            <thead>
              <tr className="text-left text-gray-500">
                <th className="py-1 pr-3 font-medium">ID</th>
                <th className="py-1 pr-3 font-medium">Card</th>
                <th className="py-1 pr-3 font-medium">Set</th>
                <th className="py-1 pr-3 font-medium text-right">Here</th>
                <th className="py-1 pr-3 font-medium text-right">后面</th>
                <th className="py-1 pr-3 font-medium text-right">门店</th>
                {ZONES.includes(picked) || picked === UNSORTED ? <th className="py-1 font-medium">Scanned</th> : null}
              </tr>
            </thead>
            <tbody>
              {shown.map(l => {
                const zoneList = ZONES.includes(picked) || picked === UNSORTED
                const gone = zoneList && (l.inv || 0) === 0
                return (
                  <tr key={l.id} className="border-t border-vault-border/40" data-testid={gone ? 'row-gone' : 'row'}>
                    <td className="py-1 pr-3 font-mono text-gray-400">{l.id}</td>
                    <td className="py-1 pr-3 text-gray-200">{l.name || 'no name on record'}</td>
                    <td className="py-1 pr-3 text-gray-400">{l.set}</td>
                    <td className="py-1 pr-3 text-right text-white font-semibold tabular-nums">{l.here}</td>
                    <td className={`py-1 pr-3 text-right tabular-nums ${gone ? 'text-red-400 font-semibold' : 'text-gray-300'}`}>{l.inv || 0}</td>
                    <td className="py-1 pr-3 text-right text-gray-300 tabular-nums">{l.store || 0}</td>
                    {zoneList ? <td className="py-1 text-gray-500">{l.at ? dayOf(l.at).slice(5) : ''}</td> : null}
                  </tr>
                )
              })}
            </tbody>
          </table>
          {!loading && shown.length === 0 && <div className="text-gray-500 text-xs py-2">Nothing here. / 这里没有卡</div>}
        </div>
      </div>
    </div>
  )
}
