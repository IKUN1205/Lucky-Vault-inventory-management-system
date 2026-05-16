import React from 'react'
import { useSearchParams } from 'react-router-dom'
import { Layers, ShieldCheck } from 'lucide-react'
import SinglesScan from './SinglesScan'
import SlabsScan from './SlabsScan'

// ============================================================================
// CardsScan — unified Scan page with Singles / Slabs tabs
// ============================================================================
// Mirrors Inventory.jsx: tab state lives in the URL (?type=singles | ?type=slabs)
// and we compose the existing SinglesScan / SlabsScan page components as
// children. Each manages its own scan history, batch queues, and modals.
// Switching tabs unmounts/remounts the child, which is fine — a tab switch
// means "I want to scan a different kind of card now", so the batch queue
// from the previous tab shouldn't bleed across.
// ============================================================================

export default function CardsScan() {
  const [searchParams, setSearchParams] = useSearchParams()
  const type = searchParams.get('type') === 'slabs' ? 'slabs' : 'singles'
  const setType = (t) => setSearchParams({ type: t }, { replace: true })

  return (
    <div className="fade-in">
      <div className="flex items-center gap-3 mb-5">
        <span className="text-xs text-gray-400 uppercase font-semibold tracking-wider">
          Type:
        </span>
        <div className="inline-flex rounded-lg border border-vault-border p-0.5 bg-vault-darker/40">
          <button
            type="button"
            onClick={() => setType('singles')}
            className={`px-4 py-1.5 text-sm rounded-md transition flex items-center gap-2 ${
              type === 'singles'
                ? 'bg-vault-gold text-vault-dark font-semibold'
                : 'text-gray-400 hover:text-white'
            }`}
          >
            <Layers size={14} /> Singles
          </button>
          <button
            type="button"
            onClick={() => setType('slabs')}
            className={`px-4 py-1.5 text-sm rounded-md transition flex items-center gap-2 ${
              type === 'slabs'
                ? 'bg-vault-gold text-vault-dark font-semibold'
                : 'text-gray-400 hover:text-white'
            }`}
          >
            <ShieldCheck size={14} /> Slabs
          </button>
        </div>
      </div>

      {type === 'singles' ? <SinglesScan /> : <SlabsScan />}
    </div>
  )
}
