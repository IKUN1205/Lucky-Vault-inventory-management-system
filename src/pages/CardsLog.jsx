import React from 'react'
import { useSearchParams } from 'react-router-dom'
import { Layers, ShieldCheck } from 'lucide-react'
import SinglesLog from './SinglesLog'
import SlabsLog from './SlabsLog'

// ============================================================================
// CardsLog — unified Activity Log with Singles / Slabs tabs
// ============================================================================
// Mirrors Inventory.jsx and CardsScan.jsx: tab state in the URL (?type=)
// so deep-links and refresh work. Each child manages its own filters and
// data load — switching tabs unmounts and remounts the child cleanly.
// ============================================================================

export default function CardsLog() {
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

      {type === 'singles' ? <SinglesLog /> : <SlabsLog />}
    </div>
  )
}
