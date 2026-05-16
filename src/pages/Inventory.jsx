import React from 'react'
import { useSearchParams } from 'react-router-dom'
import { Layers, ShieldCheck } from 'lucide-react'
import SinglesInventory from './SinglesInventory'
import SlabsInventory from './SlabsInventory'

// ============================================================================
// Inventory — unified page with Singles / Slabs tabs
// ============================================================================
// Per user directive 2026-05-15: card inventory lives on ONE page, with a
// type filter at the top to switch between the singles table (raw cards
// + TCG ID identifier) and the slabs table (graded slabs + cert#).
//
// Tab state is persisted in the URL (?type=singles | ?type=slabs) so
// deep-links work and refresh keeps your tab.
//
// We compose the existing SinglesInventory and SlabsInventory page
// components as children — each manages its own state (filters, sort,
// data loading) so this wrapper stays thin. The visible "double header"
// effect (tabs above + page header below) is intentional — tabs are
// the "type selector" chrome, the page title below confirms which
// type you're currently viewing.
// ============================================================================

export default function Inventory() {
  const [searchParams, setSearchParams] = useSearchParams()
  const type = searchParams.get('type') === 'slabs' ? 'slabs' : 'singles'
  const setType = (t) => setSearchParams({ type: t }, { replace: true })

  return (
    <div className="fade-in">
      {/* Type tabs — pill-style, sits above the embedded page */}
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

      {/* Render the appropriate inventory page. Each manages its own
          state — switching tabs unmounts/remounts the child so filters
          reset cleanly between views (which is what users expect, since
          the filter dimensions differ between singles and slabs). */}
      {type === 'singles' ? <SinglesInventory /> : <SlabsInventory />}
    </div>
  )
}
