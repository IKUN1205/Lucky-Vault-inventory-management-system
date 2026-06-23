import React, { useState, useEffect, useRef, useMemo } from 'react'
import { supabase, fetchLocations, moveSlabToLocation, markSlabAsSold } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { ToastContainer, useToast } from '../components/Toast'
import Instructions from '../components/Instructions'
import {
  Tent, ScanLine, Loader2, CheckCircle, ArrowLeftCircle, DollarSign,
  Undo2, AlertTriangle, PackageCheck,
} from 'lucide-react'

// Show Reconciliation (展会回库) — boss directive 2026-06-23.
// Cards taken to a card show get sold in person but NOT scanned out, so
// the system still thinks they're at the "Shows" location. This page:
//   1. Loads every slab currently at Shows  (= what was taken)
//   2. Staff scan the ones they brought BACK
//   3. Whatever ISN'T scanned = sold at the show
//   4. One confirm step → returned slabs move back to Slab Room (bin auto-
//      restores), un-returned slabs are marked sold (channel "shows").
// Slab-only (slabs are what goes to shows); singles aren't handled here.

const today = () => new Date().toLocaleDateString('en-CA')   // YYYY-MM-DD (local)

export default function ShowReconcile() {
  const { user } = useAuth()
  const { toasts, addToast, removeToast } = useToast()

  const [loading, setLoading] = useState(true)
  const [showsId, setShowsId] = useState(null)
  const [slabRoomId, setSlabRoomId] = useState(null)
  const [slabs, setSlabs] = useState([])            // expected: at Shows
  const [returned, setReturned] = useState(new Set()) // cert numbers scanned back
  const [scanInput, setScanInput] = useState('')
  const [stage, setStage] = useState('scanning')    // scanning | review | applying | done
  const [soldPrice, setSoldPrice] = useState({})    // cert -> price string (sold cards)
  const [results, setResults] = useState(null)
  const inputRef = useRef(null)

  useEffect(() => { load() }, [])
  useEffect(() => { if (stage === 'scanning') inputRef.current?.focus() }, [stage])

  async function load() {
    setLoading(true)
    try {
      const locs = await fetchLocations('Physical')
      const shows = locs.find(l => l.name === 'Shows')
      const slabRoom = locs.find(l => l.name === 'Slab Room')
      if (!shows) { addToast('No "Shows" location found', 'error'); setLoading(false); return }
      setShowsId(shows.id)
      setSlabRoomId(slabRoom?.id || null)
      const { data, error } = await supabase
        .from('slabs')
        .select('id, cert_number, item_name, grading_company, market_price_usd, last_slab_bin')
        .eq('location_id', shows.id)
        .eq('deleted', false)
        .in('status', ['in_inventory', 'listed'])
        .order('market_price_usd', { ascending: false, nullsFirst: false })
      if (error) throw error
      setSlabs(data || [])
    } catch (e) {
      console.error('[show-reconcile] load failed', e)
      addToast('Load failed: ' + (e.message || e), 'error')
    }
    setLoading(false)
  }

  const byCert = useMemo(() => {
    const m = new Map()
    for (const s of slabs) m.set(String(s.cert_number).trim(), s)
    return m
  }, [slabs])

  const handleScan = (e) => {
    e?.preventDefault?.()
    const code = scanInput.trim()
    if (!code) return
    setScanInput('')
    const s = byCert.get(code)
    if (!s) {
      addToast(`${code} isn't in the Shows list — was it taken to this show?`, 'info')
      return
    }
    if (returned.has(code)) { addToast(`Already marked returned: ${code}`, 'info'); return }
    setReturned(prev => new Set(prev).add(code))
    addToast(`✓ back: ${s.item_name?.slice(0, 36) || code}`, 'success')
    setTimeout(() => inputRef.current?.focus(), 0)
  }

  const toggleReturn = (cert) => {
    setReturned(prev => {
      const n = new Set(prev)
      n.has(cert) ? n.delete(cert) : n.add(cert)
      return n
    })
  }

  const returnedList = slabs.filter(s => returned.has(String(s.cert_number).trim()))
  const soldList = slabs.filter(s => !returned.has(String(s.cert_number).trim()))
  const soldValue = soldList.reduce((a, s) => a + (Number(soldPrice[s.cert_number] ?? s.market_price_usd) || 0), 0)

  const goReview = () => {
    // seed sold prices with market price (editable) for any not yet set
    setSoldPrice(prev => {
      const next = { ...prev }
      for (const s of soldList) if (next[s.cert_number] === undefined) next[s.cert_number] = s.market_price_usd ?? ''
      return next
    })
    setStage('review')
  }

  async function applyAll() {
    setStage('applying')
    const res = { returned_ok: 0, sold_ok: 0, failed: [] }
    // 1. Returned → back to Slab Room (bin auto-restores via sheet write-back)
    for (const s of returnedList) {
      try {
        if (slabRoomId) await moveSlabToLocation({ slabId: s.id, toLocationId: slabRoomId, actorId: user?.id || null })
        res.returned_ok++
      } catch (e) { res.failed.push({ cert: s.cert_number, what: 'return', err: e.message || String(e) }) }
    }
    // 2. Not returned → sold at the show
    for (const s of soldList) {
      try {
        const priceRaw = soldPrice[s.cert_number]
        const price = priceRaw === '' || priceRaw == null ? null : Number(priceRaw)
        await markSlabAsSold(s.id, {
          sale_channel: 'shows',
          sale_date: today(),
          sale_price_usd: Number.isFinite(price) ? price : null,
          sold_by_id: user?.id || null,
          sale_notes: 'Sold at card show (reconciled from Shows location)',
        })
        res.sold_ok++
      } catch (e) { res.failed.push({ cert: s.cert_number, what: 'sold', err: e.message || String(e) }) }
    }
    setResults(res)
    setStage('done')
  }

  if (loading) {
    return <div className="fade-in p-8 text-gray-400 flex items-center gap-2"><Loader2 className="animate-spin" size={18} /> Loading cards at Shows…</div>
  }

  return (
    <div className="fade-in max-w-4xl">
      <ToastContainer toasts={toasts} removeToast={removeToast} />
      <div className="mb-6">
        <h1 className="font-display text-2xl font-bold text-white flex items-center gap-3">
          <Tent className="text-vault-gold" /> Show Reconciliation
        </h1>
        <p className="text-gray-400 mt-1">Scan the slabs you brought back from the show. Whatever you don't scan = sold there.</p>
      </div>

      <Instructions>
        <div className="space-y-2 text-gray-300 text-sm">
          <p className="font-medium text-white">How it works:</p>
          <ol className="list-decimal list-inside space-y-1 ml-1">
            <li>The list below is every slab the system has at <span className="text-vault-gold">Shows</span> — i.e. everything you took.</li>
            <li>Scan each slab you <b>brought back</b>. It moves to the "Back" column.</li>
            <li>Whatever's left in "Sold at show" is what sold (taken − brought back).</li>
            <li>Hit <b>Review &amp; confirm</b>. Brought-back slabs return to the Slab Room (their old bin restores); sold ones get marked sold. Nothing changes until you confirm.</li>
          </ol>
        </div>
      </Instructions>

      {slabs.length === 0 && (
        <div className="mt-4 p-4 rounded-lg border border-vault-border bg-vault-darker/40 text-gray-400">
          No slabs are at the Shows location right now — nothing to reconcile.
        </div>
      )}

      {slabs.length > 0 && stage === 'scanning' && (
        <>
          <form onSubmit={handleScan} className="mt-4 mb-4 flex gap-2">
            <div className="relative flex-1">
              <ScanLine className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" size={18} />
              <input
                ref={inputRef}
                value={scanInput}
                onChange={(e) => setScanInput(e.target.value)}
                placeholder="Scan / type a returned slab's cert #…"
                className="w-full pl-10 pr-3 py-3 bg-vault-darker/60 border border-vault-border rounded-lg text-white"
              />
            </div>
            <button type="submit" className="px-4 py-3 bg-vault-gold/20 border border-vault-gold/50 text-vault-gold rounded-lg font-medium">Mark back</button>
          </form>

          <div className="grid grid-cols-3 gap-3 mb-4 text-center">
            <Stat label="Taken to show" value={slabs.length} cls="text-white" />
            <Stat label="Brought back" value={returnedList.length} cls="text-emerald-300" />
            <Stat label="Sold at show" value={soldList.length} cls="text-amber-300" />
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <Column title={`✅ Brought back → Slab Room (${returnedList.length})`} color="emerald">
              {returnedList.length === 0 && <Empty text="Scan a returned slab to add it here" />}
              {returnedList.map(s => (
                <Row key={s.id} s={s} action={
                  <button onClick={() => toggleReturn(String(s.cert_number).trim())} className="text-gray-500 hover:text-white" title="Undo">
                    <Undo2 size={15} />
                  </button>
                } />
              ))}
            </Column>
            <Column title={`💰 Sold at show (${soldList.length})`} color="amber">
              {soldList.length === 0 && <Empty text="Everything's been scanned back" />}
              {soldList.map(s => (
                <Row key={s.id} s={s} action={
                  <button onClick={() => toggleReturn(String(s.cert_number).trim())} className="text-[10px] px-1.5 py-0.5 border border-emerald-500/40 text-emerald-300 rounded" title="Actually came back">
                    came back
                  </button>
                } />
              ))}
            </Column>
          </div>

          <div className="mt-5 flex justify-end">
            <button onClick={goReview} disabled={slabs.length === 0}
              className="px-5 py-3 bg-vault-gold text-vault-dark font-semibold rounded-lg flex items-center gap-2 disabled:opacity-50">
              Review &amp; confirm →
            </button>
          </div>
        </>
      )}

      {stage === 'review' && (
        <div className="mt-4">
          <div className="grid grid-cols-3 gap-3 mb-4 text-center">
            <Stat label="Back to Slab Room" value={returnedList.length} cls="text-emerald-300" />
            <Stat label="Sold at show" value={soldList.length} cls="text-amber-300" />
            <Stat label="Sold value" value={`$${soldValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}`} cls="text-vault-gold" />
          </div>

          <div className="p-4 rounded-lg border border-amber-500/40 bg-amber-500/5 mb-4">
            <p className="text-amber-200 font-medium mb-2 flex items-center gap-2"><DollarSign size={16} /> These {soldList.length} will be marked SOLD at the show:</p>
            <p className="text-xs text-gray-400 mb-3">Price defaults to market value — edit if you know the real sale price, or clear it to mark sold without a price. Channel = "shows".</p>
            <div className="max-h-72 overflow-y-auto divide-y divide-vault-border/40">
              {soldList.map(s => (
                <div key={s.id} className="flex items-center gap-3 py-1.5">
                  <div className="flex-1 min-w-0">
                    <div className="text-white text-sm truncate">{s.item_name}</div>
                    <div className="text-[11px] text-gray-500">{s.grading_company} · cert #{s.cert_number}</div>
                  </div>
                  <div className="relative">
                    <span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-500 text-xs">$</span>
                    <input
                      type="number" min="0" step="0.01"
                      value={soldPrice[s.cert_number] ?? ''}
                      onChange={(e) => setSoldPrice(p => ({ ...p, [s.cert_number]: e.target.value }))}
                      className="w-24 pl-5 pr-2 py-1 bg-vault-darker/60 border border-vault-border rounded text-white text-sm text-right"
                    />
                  </div>
                </div>
              ))}
              {soldList.length === 0 && <p className="text-gray-500 text-sm py-2">Nothing sold — everything came back.</p>}
            </div>
          </div>

          {returnedList.length > 0 && (
            <p className="text-sm text-emerald-300/80 mb-4 flex items-center gap-2">
              <PackageCheck size={15} /> {returnedList.length} brought-back slab{returnedList.length === 1 ? '' : 's'} will return to the Slab Room (original bins restore automatically).
            </p>
          )}

          <div className="flex justify-between">
            <button onClick={() => setStage('scanning')} className="px-4 py-2.5 text-gray-300 hover:text-white flex items-center gap-1.5">
              <ArrowLeftCircle size={16} /> Back to scanning
            </button>
            <button onClick={applyAll}
              className="px-6 py-3 bg-emerald-500/90 hover:bg-emerald-500 text-white font-semibold rounded-lg flex items-center gap-2">
              <CheckCircle size={18} /> Confirm — return {returnedList.length}, sell {soldList.length}
            </button>
          </div>
        </div>
      )}

      {stage === 'applying' && (
        <div className="mt-8 text-center text-gray-300 flex flex-col items-center gap-3">
          <Loader2 className="animate-spin text-vault-gold" size={28} />
          Applying… moving {returnedList.length} back, selling {soldList.length}.
        </div>
      )}

      {stage === 'done' && results && (
        <div className="mt-6 p-5 rounded-xl border border-emerald-500/40 bg-emerald-500/5">
          <h3 className="text-lg font-semibold text-emerald-200 flex items-center gap-2 mb-3"><CheckCircle size={20} /> Show reconciled</h3>
          <ul className="text-sm text-gray-200 space-y-1">
            <li>✅ {results.returned_ok} slab{results.returned_ok === 1 ? '' : 's'} returned to the Slab Room</li>
            <li>💰 {results.sold_ok} slab{results.sold_ok === 1 ? '' : 's'} marked sold at the show</li>
            {results.failed.length > 0 && (
              <li className="text-red-300 flex items-start gap-1.5 mt-2">
                <AlertTriangle size={15} className="mt-0.5" />
                <span>{results.failed.length} failed: {results.failed.slice(0, 5).map(f => `${f.cert} (${f.what})`).join(', ')}{results.failed.length > 5 ? '…' : ''}. Check the console / retry.</span>
              </li>
            )}
          </ul>
          <button onClick={() => { setReturned(new Set()); setSoldPrice({}); setResults(null); setStage('scanning'); load() }}
            className="mt-4 px-4 py-2 border border-vault-border text-gray-200 rounded-lg hover:bg-vault-darker">
            Reload Shows list
          </button>
        </div>
      )}
    </div>
  )
}

function Stat({ label, value, cls }) {
  return (
    <div className="p-3 rounded-lg border border-vault-border bg-vault-darker/40">
      <div className={`text-2xl font-bold ${cls}`}>{value}</div>
      <div className="text-[11px] text-gray-500 uppercase tracking-wider">{label}</div>
    </div>
  )
}
function Column({ title, color, children }) {
  return (
    <div className={`rounded-lg border p-3 ${color === 'emerald' ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-amber-500/30 bg-amber-500/5'}`}>
      <h3 className="text-sm font-semibold text-white mb-2">{title}</h3>
      <div className="space-y-1 max-h-80 overflow-y-auto">{children}</div>
    </div>
  )
}
function Row({ s, action }) {
  return (
    <div className="flex items-center gap-2 py-1 border-b border-vault-border/30 last:border-0">
      <div className="flex-1 min-w-0">
        <div className="text-white text-xs truncate">{s.item_name}</div>
        <div className="text-[10px] text-gray-500">#{s.cert_number} · ${s.market_price_usd ?? '?'}</div>
      </div>
      {action}
    </div>
  )
}
function Empty({ text }) { return <p className="text-gray-600 text-xs italic py-2">{text}</p> }
