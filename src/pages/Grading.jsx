import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, CheckCircle, Loader2, ScanLine, Undo2 } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { ToastContainer, useToast } from '../components/Toast'
import { labelId } from '../lib/stockCheck'
import { DECISION_LABEL, REASON_LABEL, batchSummary, planScan, variantLabel } from '../lib/grading'
import { PutAway } from './StockCheck'

// Will 2026-11-26 (D-20261126-02): a Roca batch with labels goes to Kevin. When he is done, every label is scanned here as
// Grading (he keeps it) or Stock (goes into TCGplayer Singles, zone Unsorted). This page only records; the stock cards are put
// into inventory afterwards by the intake script (row merge, cost = market x 80%). Finish takes the batch off the list; cards
// not scanned and scans that match nothing stay on the batch's record so they can be looked into.

const PAGE = 1000
async function readAll(build) {
  const out = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build().range(from, from + PAGE - 1)
    if (error) throw error
    out.push(...(data || []))
    if (!data || data.length < PAGE) return out
  }
}

const usd = (v) => (v == null ? '—' : `$${Number(v).toFixed(2)}`)

export default function Grading() {
  const { toasts, addToast, removeToast } = useToast()
  const { user } = useAuth()
  const [batches, setBatches] = useState([])
  const [finished, setFinished] = useState([])
  const [batchId, setBatchId] = useState('')
  const [cards, setCards] = useState([])
  const [extras, setExtras] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadedId, setLoadedId] = useState('')   // the batch whose cards are on screen
  const [pending, setPending] = useState(0)      // scans / undos waiting or being saved
  const [mode, setMode] = useState('stock')
  const [scan, setScan] = useState('')
  const [choose, setChoose] = useState(null)     // { id, options, decision, resolve }
  const [last, setLast] = useState([])           // this screen's scans, newest first: { seq?, extraId?, id, decision, name, failed? }
  const [filter, setFilter] = useState('all')
  const [tab, setTab] = useState('scan')            // Will 11/26: 'scan' a batch, or 'zones' = Unsorted -> each zone (was Put Away on Stock Check)
  const [finishing, setFinishing] = useState(false)   // Codex 11/26: no new scans once Finish is confirmed
  const inputRef = useRef(null)
  // Codex 11/26: scans are queued and saved one after another from these refs, so a slow save never drops the next scan and a
  // scan always plans on the batch it was made in.
  const cardsRef = useRef([])
  const extrasRef = useRef([])
  const loadedRef = useRef('')
  const loadSeq = useRef(0)
  const loadPromise = useRef(Promise.resolve())
  const chain = useRef(Promise.resolve())

  const batch = batches.find(b => b.id === batchId) || null
  const summary = useMemo(() => batchSummary(cards, extras), [cards, extras])
  const setC = (fn) => { cardsRef.current = fn(cardsRef.current); setCards(cardsRef.current) }
  const setX = (fn) => { extrasRef.current = fn(extrasRef.current); setExtras(extrasRef.current) }
  const note = (e) => setLast(l => [e, ...l].slice(0, 30))

  const loadBatches = useCallback(async () => {
    const [{ data: open, error: e1 }, { data: done, error: e2 }] = await Promise.all([
      supabase.from('grading_batches').select('id, name, roca_batch, status, created_at').eq('status', 'open').order('created_at'),
      supabase.from('grading_batches').select('id, name, roca_batch, status, result, finished_at, intake_job').eq('status', 'finished').order('finished_at', { ascending: false }).limit(20),
    ])
    if (e1 || e2) throw e1 || e2
    setBatches(open || [])
    setFinished(done || [])
  }, [])

  // Read one batch; a reply for a batch no longer chosen is dropped.
  const loadBatch = useCallback((id) => {
    const token = ++loadSeq.current
    loadedRef.current = ''; setLoadedId('')
    cardsRef.current = []; extrasRef.current = []; setCards([]); setExtras([])
    if (!id) { loadPromise.current = Promise.resolve(); return loadPromise.current }
    loadPromise.current = (async () => {
      const [c, x] = await Promise.all([
        readAll(() => supabase.from('grading_batch_cards').select('*').eq('batch_id', id).order('seq')),
        readAll(() => supabase.from('grading_batch_extras').select('*').eq('batch_id', id).order('scanned_at')),
      ])
      if (token !== loadSeq.current) return
      cardsRef.current = c; extrasRef.current = x; setCards(c); setExtras(x)
      loadedRef.current = id; setLoadedId(id)
    })().catch(e => { if (token === loadSeq.current) addToast(`Could not read the batch: ${e.message}`, 'error') })
    return loadPromise.current
  }, [])

  useEffect(() => {
    (async () => {
      try { await loadBatches() } catch (e) { addToast(`Could not read the batches: ${e.message}`, 'error') }
      setLoading(false)
    })()
  }, [loadBatches])

  useEffect(() => { setLast([]); loadBatch(batchId) }, [batchId, loadBatch])

  const focus = () => setTimeout(() => inputRef.current?.focus(), 0)

  // Run tasks one at a time, in scan order.
  const enqueue = (task) => {
    setPending(n => n + 1)
    chain.current = chain.current.then(task).catch(e => addToast(e.message, 'error')).finally(() => setPending(n => n - 1))
    return chain.current
  }

  // Mark one card of batch b, only if nobody marked it meanwhile. Returns false when the card was taken.
  const mark = async (b, card, decision) => {
    const at = new Date().toISOString()
    const { data, error } = await supabase.from('grading_batch_cards')
      .update({ decision, scanned_at: at, scanned_by_id: user?.id || null })
      .eq('batch_id', b).eq('seq', card.seq).is('decision', null).select('seq')
    if (error) throw error
    if (!data || data.length !== 1) return false
    setC(cs => cs.map(c => (c.seq === card.seq ? { ...c, decision, scanned_at: at } : c)))
    note({ seq: card.seq, id: card.tcg_id, decision, name: card.card_name })
    addToast(`#${card.seq} ${card.card_name} → ${DECISION_LABEL[decision]}`, 'success')
    return true
  }

  const addExtra = async (b, id, reason, decision) => {
    const { data, error } = await supabase.from('grading_batch_extras')
      .insert({ batch_id: b, tcg_id: id, decision, reason, scanned_by_id: user?.id || null }).select('*')
    if (error) throw error
    setX(x => [...x, ...(data || [])])
    note({ extraId: data?.[0]?.id, id, decision, name: REASON_LABEL[reason] })
    addToast(`${id}: ${REASON_LABEL[reason]} — recorded`, 'error')
  }

  const processScan = async (b, id, decision) => {
    try {
      await loadPromise.current
      if (loadedRef.current !== b) throw new Error('batch changed before it was saved')
      for (let attempt = 0; attempt < 2; attempt++) {
        const p = planScan(cardsRef.current, id)
        if (p.kind === 'extra') { await addExtra(b, id, p.reason, decision); return }
        let card = p.card
        if (p.kind === 'choose') {
          const opt = await new Promise(resolve => setChoose({ id, options: p.options, decision, resolve }))
          setChoose(null)
          if (opt === 'cancel') throw new Error('cancelled')
          if (opt === 'more') { await addExtra(b, id, 'more_than_batch', decision); return }
          card = opt.card
        }
        if (await mark(b, card, decision)) return
        await loadBatch(b)              // another screen took that copy: read again and plan once more
        if (loadedRef.current !== b) throw new Error('batch changed before it was saved')
      }
      throw new Error('another screen keeps scanning the same card')
    } catch (e) {
      note({ id, decision, name: `NOT saved: ${e.message} — scan again`, failed: true })
      addToast(`${id} NOT saved: ${e.message}. Scan it again.`, 'error')
    } finally { focus() }
  }

  const onScan = () => {
    const raw = scan.trim()
    if (!raw || !batchId) return
    if (finishing) { addToast('Finishing this batch: scan not taken', 'error'); setScan(''); return }
    setScan('')
    const id = labelId(raw)
    if (!/^\d+$/.test(id)) { addToast(`"${raw}" is not a label number`, 'error'); focus(); return }
    enqueue(() => processScan(batchId, id, mode))
  }

  // Take back one scan of this screen (a card or a recorded extra).
  const undo = (entry) => {
    const b = batchId
    enqueue(async () => {
      try {
        if (loadedRef.current !== b) throw new Error('batch changed')
        if (entry.extraId) {
          const { data, error } = await supabase.from('grading_batch_extras').delete().eq('id', entry.extraId).eq('batch_id', b).select('id')
          if (error) throw error
          if (!data || data.length !== 1) throw new Error('already gone')
          setX(x => x.filter(e => e.id !== entry.extraId))
        } else {
          const { data, error } = await supabase.from('grading_batch_cards')
            .update({ decision: null, scanned_at: null, scanned_by_id: null })
            .eq('batch_id', b).eq('seq', entry.seq).eq('decision', entry.decision).select('seq')
          if (error) throw error
          if (!data || data.length !== 1) { await loadBatch(b); throw new Error(`#${entry.seq} changed meanwhile, list read again`) }
          setC(cs => cs.map(c => (c.seq === entry.seq ? { ...c, decision: null, scanned_at: null } : c)))
        }
        setLast(l => l.filter(e => e !== entry))
        addToast('Scan taken back', 'info')
      } catch (e) {
        addToast(`Undo failed: ${e.message}`, 'error')
      } finally { focus() }
    })
  }

  const finish = async () => {
    if (!batch || pending) return
    const s = batchSummary(cardsRef.current, extrasRef.current)
    const msg = `Finish ${batch.name}?\n\nGrading: ${s.grading}\nStock / 入库: ${s.stock}\nNot scanned / 没扫到: ${s.left}\nScans that match nothing / 对不上: ${s.extras.length}\n\n`
      + 'The batch leaves the list. Cards not scanned and scans that match nothing stay on its record.'
    if (!window.confirm(msg)) return
    const b = batchId, name = batch.name
    setFinishing(true)
    await enqueue(async () => {
      // grading_finish closes the batch and counts from the tables in one transaction; after it no scan of this batch can change.
      const { data: result, error } = await supabase.rpc('grading_finish', { p_batch: b, p_by: user?.id || null })
      if (error) { setFinishing(false); addToast(`Not finished: ${error.message}`, 'error'); return }
      addToast(`${name} finished: ${result.grading} grading, ${result.stock} stock, ${result.left} not scanned, ${result.extras.length} not matching`, 'success')
      setBatchId('')
      setFinishing(false)
      try { await loadBatches() } catch (e) { addToast(`Could not read the batches: ${e.message}`, 'error') }
    })
  }

  const shown = cards.filter(c => (filter === 'all' ? true : filter === 'left' ? !c.decision : c.decision === filter))

  if (loading) return <div className="p-6 flex items-center gap-2 text-gray-400"><Loader2 className="animate-spin" size={18} /> Loading…</div>

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-6xl">
      <ToastContainer toasts={toasts} removeToast={removeToast} />
      <div>
        <h1 className="text-2xl font-bold text-white flex items-center gap-2"><ScanLine size={22} /> Grading</h1>
        <p className="text-sm text-gray-400 mt-1">
          Roca batch back from Kevin: scan each label as <b>Grading</b> (Kevin keeps it) or <b>Stock</b> (goes into TCGplayer Singles, zone Unsorted).
          Stock cards are put into inventory after you finish the batch. 扫完点 Finish，这一批就从列表里拿掉。
        </p>
      </div>

      <div className="flex gap-2">
        {[['scan', 'Scan batch / 扫批次'], ['zones', 'Unsorted → zones / 放分区']].map(([k, l]) => (
          <button key={k} type="button" onClick={() => setTab(k)} disabled={k === 'zones' && (pending > 0 || !!choose)}
            className={`px-4 py-2 rounded font-semibold ${tab === k ? 'bg-vault-gold text-black' : 'bg-vault-dark text-gray-300 border border-gray-600'}`}>{l}</button>
        ))}
      </div>

      {/* Codex 11/26: kept mounted while hidden, so its queued writes, prompts and Undo survive a tab switch */}
      <div className={tab === 'zones' ? '' : 'hidden'}><PutAway addToast={addToast} user={user} /></div>

      {tab === 'scan' && (<>
      <div className="card p-4 flex flex-wrap items-end gap-4">
        <label className="flex flex-col text-sm text-gray-300">
          Batch / 批次
          <select value={batchId} onChange={e => setBatchId(e.target.value)} disabled={pending > 0 || !!choose} className="mt-1 min-w-64">
            <option value="">— choose —</option>
            {batches.map(b => <option key={b.id} value={b.id}>{b.name}{b.roca_batch ? ` (Roca ${b.roca_batch})` : ''}</option>)}
          </select>
        </label>
        {batches.length === 0 && <span className="text-sm text-gray-400">No batch waiting.</span>}
        {batch && (
          <div className="flex gap-2">
            {['grading', 'stock'].map(d => (
              <button key={d} type="button" onClick={() => { setMode(d); focus() }}
                className={`px-4 py-2 rounded font-semibold ${mode === d ? (d === 'grading' ? 'bg-purple-600 text-white' : 'bg-green-600 text-white') : 'bg-vault-dark text-gray-300 border border-gray-600'}`}>
                {DECISION_LABEL[d]}
              </button>
            ))}
          </div>
        )}
      </div>

      {batch && (
        <>
          <div className={`card p-4 border-2 ${mode === 'grading' ? 'border-purple-600' : 'border-green-600'}`}>
            <div className="text-sm text-gray-300 mb-2">Scanning as <b className="text-white">{DECISION_LABEL[mode]}</b>
              {loadedId !== batchId && <span className="ml-2 text-yellow-300">reading the batch… (scans wait)</span>}
              {pending > 0 && <span className="ml-2 text-yellow-300">{pending} saving / waiting</span>}</div>
            <div className="flex gap-2">
              <input ref={inputRef} value={scan} onChange={e => setScan(e.target.value)} autoFocus disabled={finishing}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onScan() } }}
                placeholder="Scan label / 扫 label" className="flex-1 text-lg" />
              <button type="button" onClick={onScan} disabled={!scan.trim()} className="btn btn-primary">
                {pending ? <Loader2 size={16} className="animate-spin" /> : 'OK'}
              </button>
            </div>
            {choose && (
              <div className="mt-3 p-3 rounded bg-yellow-900/30 border border-yellow-600">
                <div className="text-yellow-300 text-sm mb-2 flex items-center gap-1"><AlertTriangle size={14} /> {choose.id} is in this batch in more than one version. Which one is this card? (next scans wait)</div>
                <div className="flex flex-wrap gap-2">
                  {choose.options.map(o => (
                    <button key={o.key} type="button" onClick={() => { choose.resolve(o); focus() }} className="btn btn-secondary">
                      {o.card.card_name} {o.card.card_number || ''} · {o.label} · {usd(o.card.market_usd)} ({o.left} left)
                    </button>
                  ))}
                  <button type="button" onClick={() => { choose.resolve('more'); focus() }} className="btn btn-secondary">None of these: one more than the batch has / 都不是（比批次多）</button>
                  <button type="button" onClick={() => { choose.resolve('cancel'); focus() }} className="btn">Cancel (not saved)</button>
                </div>
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <Stat label="Cards in batch" value={summary.cards} />
            <Stat label="Grading" value={summary.grading} sub={usd(summary.gradingMarket)} tone="text-purple-300" />
            <Stat label="Stock / 入库" value={summary.stock} sub={usd(summary.stockMarket)} tone="text-green-300" />
            <Stat label="Not scanned / 没扫" value={summary.left} tone={summary.left ? 'text-yellow-300' : ''} />
            <Stat label="Not matching / 对不上" value={extras.length} tone={extras.length ? 'text-red-300' : ''} />
          </div>

          {last.length > 0 && (
            <div className="card p-3">
              <div className="text-sm text-gray-400 mb-2">Last scans (this screen)</div>
              <div className="space-y-1">
                {last.slice(0, 8).map((e, i) => (
                  <div key={i} className="flex items-center gap-2 text-sm">
                    <span className={e.failed ? 'text-red-400' : e.decision === 'grading' ? 'text-purple-300' : 'text-green-300'}>{DECISION_LABEL[e.decision]}</span>
                    <span className="text-white">{e.seq != null ? `#${e.seq} ` : ''}{e.id}</span>
                    <span className={`truncate ${e.failed ? 'text-red-400' : 'text-gray-400'}`}>{e.name}</span>
                    {!e.failed && <button type="button" onClick={() => undo(e)} className="ml-auto text-gray-400 hover:text-white flex items-center gap-1"><Undo2 size={14} /> undo</button>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {extras.length > 0 && (
            <div className="card p-3 border border-red-700">
              <div className="text-sm text-red-300 mb-2">Scans that match nothing in this batch / 扫到但对不上的</div>
              {extras.map(e => (
                <div key={e.id} className="text-sm text-gray-200">{e.tcg_id} · {DECISION_LABEL[e.decision]} · {REASON_LABEL[e.reason]} · {new Date(e.scanned_at).toLocaleString()}</div>
              ))}
            </div>
          )}

          <div className="card p-3">
            <div className="flex flex-wrap items-center gap-2 mb-2">
              {[['all', 'All'], ['left', 'Not scanned'], ['grading', 'Grading'], ['stock', 'Stock']].map(([k, l]) => (
                <button key={k} type="button" onClick={() => setFilter(k)} className={`px-3 py-1 rounded text-sm ${filter === k ? 'bg-vault-gold text-black' : 'bg-vault-dark text-gray-300'}`}>{l}</button>
              ))}
              <button type="button" onClick={finish} disabled={pending > 0 || !!choose || loadedId !== batchId} className="ml-auto btn btn-primary flex items-center gap-1"><CheckCircle size={16} /> Finish batch</button>
            </div>
            <div className="overflow-x-auto max-h-[60vh]">
              <table className="w-full text-sm">
                <thead className="text-gray-400 text-left sticky top-0 bg-vault-darker">
                  <tr><th className="p-1">#</th><th className="p-1">TCG id</th><th className="p-1">Card</th><th className="p-1">Version</th><th className="p-1 text-right">Market</th><th className="p-1">Where</th></tr>
                </thead>
                <tbody>
                  {shown.map(c => (
                    <tr key={c.seq} className="border-t border-gray-800">
                      <td className="p-1 text-gray-400">{c.seq}</td>
                      <td className="p-1">{c.tcg_id}</td>
                      <td className="p-1 text-white">{c.card_name} <span className="text-gray-400">{c.card_number || ''}</span></td>
                      <td className="p-1 text-gray-300">{variantLabel(c)}</td>
                      <td className="p-1 text-right">{usd(c.market_usd)}</td>
                      <td className={`p-1 ${c.decision === 'grading' ? 'text-purple-300' : c.decision === 'stock' ? 'text-green-300' : 'text-yellow-300'}`}>{c.decision ? DECISION_LABEL[c.decision] : 'not scanned'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {finished.length > 0 && (
        <div className="card p-3">
          <div className="text-sm text-gray-400 mb-2">Finished batches / 已完成</div>
          {finished.map(b => {
            const r = b.result || {}
            return (
              <details key={b.id} className="border-t border-gray-800 py-1">
                <summary className="cursor-pointer text-sm text-gray-200">
                  {b.name} · {b.finished_at ? new Date(b.finished_at).toLocaleDateString() : ''} · grading {r.grading ?? 0} · stock {r.stock ?? 0}
                  {r.left ? <span className="text-yellow-300"> · not scanned {r.left}</span> : null}
                  {r.extras?.length ? <span className="text-red-300"> · not matching {r.extras.length}</span> : null}
                  <span className="text-gray-500"> · {b.intake_job ? `in stock (${b.intake_job})` : 'stock cards not in inventory yet'}</span>
                </summary>
                <div className="pl-4 text-xs text-gray-300 space-y-0.5 mt-1">
                  {(r.missing || []).map(m => <div key={`m${m.seq}`}>not scanned: #{m.seq} {m.tcg_id} {m.name} {m.number || ''} {m.printing || ''} {usd(m.market)}</div>)}
                  {(r.extras || []).map((e, i) => <div key={`x${i}`}>not matching: {e.tcg_id} · {DECISION_LABEL[e.decision]} · {REASON_LABEL[e.reason]}</div>)}
                </div>
              </details>
            )
          })}
        </div>
      )}
      </>)}
    </div>
  )
}

function Stat({ label, value, sub, tone = '' }) {
  return (
    <div className="card p-3">
      <div className="text-xs text-gray-400">{label}</div>
      <div className={`text-2xl font-bold text-white ${tone}`}>{value}</div>
      {sub && <div className="text-xs text-gray-400">{sub}</div>}
    </div>
  )
}
