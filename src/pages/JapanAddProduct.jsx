import React, { useState, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { upsertProducts } from '../lib/supabase'
import { ToastContainer, useToast } from '../components/Toast'
import { useAuth } from '../lib/AuthContext'
import { Plus, Save, AlertCircle } from 'lucide-react'
import {
  SERIES_LIST,
  SERIES_TO_BRAND,
  VARIANT_ORDER,
  VARIANT_META,
  variantChipClasses,
  variantLabel,
  buildJapanProductName,
  buildJapanProductAliases,
  variantToType,
  DEFAULT_VARIANTS_FOR_NEW_SET,
} from '../lib/japanVariants'

// ============================================================================
// 日本新增 SKU / Japan Add Product
// ============================================================================
// Japan-flavored Add Product. Fills 4 inputs once (series, short_code,
// english_name, packs_per_box) then ticks variants to create — one submit
// stamps out N consistent SKUs with auto-generated names + aliases.
//
// Why this exists vs the generic Add Product page:
//   - Single physical card splits into multiple Japan SKUs (有膜/无膜/
//     垃圾袋/散包/etc.); the US-style form asked the user to fill the same
//     set name + product type 4 times.
//   - SKU naming + aliases follow a strict convention (see japanVariants.js);
//     fanning the convention out automatically beats 4 manual entries.
//   - Brand inferred from series_zh; language hard-coded to JP.
// ============================================================================

const PACK_VARIANTS = new Set(['in_bag', 'single_pack'])

export default function JapanAddProduct() {
  const { toasts, addToast, removeToast } = useToast()
  const { user } = useAuth()
  const [submitting, setSubmitting] = useState(false)

  const [form, setForm] = useState({
    series_zh: '宝可梦',
    short_code: '',
    english_name: '',
    packs_per_box: 30,    // default for sealed-style variants; ignored for packs
  })

  // Which variants to create. Default-checked = the 4 common ones.
  const [chosen, setChosen] = useState(() => new Set(DEFAULT_VARIANTS_FOR_NEW_SET))

  const handleChange = (e) => {
    const { name, value } = e.target
    setForm(f => ({ ...f, [name]: value }))
  }

  const toggleVariant = (v) => {
    setChosen(prev => {
      const next = new Set(prev)
      if (next.has(v)) next.delete(v); else next.add(v)
      return next
    })
  }

  const brand = SERIES_TO_BRAND[form.series_zh] || 'Other'

  // Preview rows live — same calculation as what hits the DB on submit, so
  // the table at the bottom shows exactly what the user is about to create.
  const previewRows = useMemo(() => {
    const e = (form.english_name || '').trim()
    if (!e || !form.short_code.trim() || chosen.size === 0) return []
    return [...chosen]
      .sort((a, b) => VARIANT_ORDER.indexOf(a) - VARIANT_ORDER.indexOf(b))
      .map(variant => {
        const type = variantToType(variant)
        const isPack = PACK_VARIANTS.has(variant)
        return {
          variant,
          name: buildJapanProductName(e, variant),
          aliases: buildJapanProductAliases({
            short_code: form.short_code.trim(),
            series_zh: form.series_zh,
            english_name: e,
            variant,
          }),
          brand,
          language: 'JP',
          type,
          category: isPack ? 'Booster Pack' : 'Booster Box',
          breakable: !isPack,
          packs_per_box: isPack ? null : Number(form.packs_per_box) || 30,
          short_code: form.short_code.trim(),
        }
      })
  }, [form, chosen, brand])

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!form.short_code.trim()) {
      addToast('Short code required (M2a, OP-15, ...)', 'error'); return
    }
    if (!form.english_name.trim()) {
      addToast('English name required', 'error'); return
    }
    if (chosen.size === 0) {
      addToast('Pick at least one variant', 'error'); return
    }

    setSubmitting(true)
    try {
      const rows = previewRows.map(p => ({
        name: p.name,
        brand: p.brand,
        language: p.language,
        type: p.type,
        category: p.category,
        breakable: p.breakable,
        packs_per_box: p.packs_per_box,
        aliases: p.aliases,
        short_code: p.short_code,
        variant: p.variant,
        active: true,
      }))
      const { created, updated } = await upsertProducts(rows)
      const msg = updated > 0
        ? `✓ ${created} new SKU${created === 1 ? '' : 's'} created · ${updated} already existed (updated taxonomy)`
        : `✓ ${created} new SKU${created === 1 ? '' : 's'} created`
      addToast(msg, 'success')

      // Fire-and-forget Lark: reuses the existing add_product type with a
      // synthesized prods array (the existing builder iterates products[]).
      try {
        fetch('/api/lark-notify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'add_product',
            user: user?.name || 'Unknown',
            mode: 'bulk',
            products: rows.map(r => ({
              name: r.name,
              brand: r.brand,
              language: r.language,
              type: r.category,
              breakable: r.breakable,
              packs_per_box: r.packs_per_box,
            })),
          }),
        }).catch(err => console.error('[lark-notify] jp_add_product failed:', err))
      } catch (err) {
        console.error('[lark-notify] jp_add_product payload build failed:', err)
      }

      // Reset short_code + english_name; keep series + packs_per_box so
      // batches of related sets go fast.
      setForm(f => ({ ...f, short_code: '', english_name: '' }))
      setChosen(new Set(DEFAULT_VARIANTS_FOR_NEW_SET))
    } catch (err) {
      console.error('[JapanAddProduct] submit failed:', err)
      addToast(`Failed: ${err.message || err}`, 'error')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fade-in space-y-6">
      <ToastContainer toasts={toasts} removeToast={removeToast} />

      <div>
        <h1 className="font-display text-2xl font-bold text-white flex items-center gap-3">
          <Plus className="text-vault-gold" />
          🇯🇵 日本新增 SKU / Japan Add Product
        </h1>
        <p className="text-gray-400 mt-1">
          Fill once → stamp out the sealed / 无膜 / 垃圾袋 / 散包 / etc. variants in one go.
          Naming and aliases auto-generated from the inputs below.
          <span className="block text-xs text-gray-500 mt-1">
            For US-style products (sealed boxes, single packs without variant taxonomy) use the
            generic <Link to="/add-product" className="text-vault-gold hover:underline">Add Product</Link> page instead.
          </span>
        </p>
      </div>

      <form onSubmit={handleSubmit} className="card max-w-4xl space-y-4">
        {/* Identity row */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
          <div className="md:col-span-3">
            <label className="block text-sm font-medium text-gray-300 mb-2">系列 / Series *</label>
            <select name="series_zh" value={form.series_zh} onChange={handleChange} required>
              {SERIES_LIST.map(s => (
                <option key={s} value={s}>{s} ({SERIES_TO_BRAND[s]})</option>
              ))}
            </select>
          </div>
          <div className="md:col-span-3">
            <label className="block text-sm font-medium text-gray-300 mb-2">Short Code *</label>
            <input
              type="text"
              name="short_code"
              value={form.short_code}
              onChange={handleChange}
              placeholder="M2a, OP-15, EB-04..."
              autoComplete="off"
              required
              className="w-full"
            />
            <p className="text-[10px] text-gray-500 mt-1">{form.series_zh === '宝可梦' ? 'M2a / SV10 / M5 ...' : form.series_zh === '海贼王' ? 'OP-15 / EB-04 / PRB-02 ...' : 'set code'}</p>
          </div>
          <div className="md:col-span-6">
            <label className="block text-sm font-medium text-gray-300 mb-2">English Name *</label>
            <input
              type="text"
              name="english_name"
              value={form.english_name}
              onChange={handleChange}
              placeholder="e.g. MEGA Dream ex, Adventure on KAMI's Island"
              autoComplete="off"
              required
              className="w-full"
            />
            <p className="text-[10px] text-gray-500 mt-1">Used as the base for all variant names (no variant suffix needed — that's auto-appended).</p>
          </div>
        </div>

        {/* Variant picker */}
        <div className="pt-3 border-t border-vault-border">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-white text-sm">变体 / Variants to create</h3>
            <div className="flex items-center gap-2 text-xs">
              <button
                type="button"
                onClick={() => setChosen(new Set(DEFAULT_VARIANTS_FOR_NEW_SET))}
                className="text-gray-400 hover:text-vault-gold"
              >
                Default 4
              </button>
              <span className="text-gray-700">·</span>
              <button
                type="button"
                onClick={() => setChosen(new Set(VARIANT_ORDER.filter(v => !['single_card', 'black_box'].includes(v))))}
                className="text-gray-400 hover:text-vault-gold"
              >
                All sealed-system
              </button>
              <span className="text-gray-700">·</span>
              <button
                type="button"
                onClick={() => setChosen(new Set())}
                className="text-gray-400 hover:text-red-300"
              >
                Clear
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            {VARIANT_ORDER.filter(v => !['single_card', 'black_box'].includes(v)).map(v => {
              const meta = VARIANT_META[v]
              const active = chosen.has(v)
              return (
                <label
                  key={v}
                  className={`flex items-center gap-2 p-2 rounded-lg border cursor-pointer transition ${
                    active
                      ? `${meta.color} font-semibold`
                      : 'bg-vault-darker/40 border-vault-border text-gray-400 hover:border-vault-gold/40 hover:text-white'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={active}
                    onChange={() => toggleVariant(v)}
                    className="accent-vault-gold"
                  />
                  <span className="text-sm">{meta.zh}</span>
                  <span className="text-[10px] text-gray-500 ml-auto">{meta.en}</span>
                </label>
              )
            })}
          </div>

          <p className="text-[10px] text-gray-500 mt-2">
            单卡 / 黑盒 belong in the Singles system, not here — hidden on purpose.
          </p>
        </div>

        {/* Packs per box override (only useful when any box-style variant chosen) */}
        {[...chosen].some(v => !PACK_VARIANTS.has(v)) && (
          <div className="pt-3 border-t border-vault-border">
            <label className="block text-sm font-medium text-gray-300 mb-2"># of Packs per Box (for Booster Box variants)</label>
            <input
              type="number"
              name="packs_per_box"
              value={form.packs_per_box}
              onChange={handleChange}
              min="1"
              className="max-w-xs"
            />
            <p className="text-[10px] text-gray-500 mt-1">JP boxes are usually 30. EN boxes are 36. Doesn't apply to 散包/垃圾袋 (Pack rows).</p>
          </div>
        )}

        {/* Live preview of what we'll create */}
        {previewRows.length > 0 ? (
          <div className="pt-3 border-t border-vault-border">
            <h3 className="font-semibold text-white text-sm mb-2">Preview — will create {previewRows.length} SKU{previewRows.length === 1 ? '' : 's'}</h3>
            <div className="bg-vault-darker/40 border border-vault-border rounded-lg p-3 space-y-1.5">
              {previewRows.map(p => (
                <div key={p.variant} className="flex items-center gap-2 text-sm">
                  <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold border ${variantChipClasses(p.variant)} flex-shrink-0`}>
                    {variantLabel(p.variant)}
                  </span>
                  <span className="text-white">{p.name}</span>
                  <span className="text-[10px] text-gray-500 ml-auto truncate" title={p.aliases.join(' · ')}>
                    aliases: {p.aliases.join(' · ')}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="pt-3 border-t border-vault-border text-xs text-gray-500 flex items-center gap-2">
            <AlertCircle size={12} />
            Fill the inputs above to see a preview.
          </div>
        )}

        <div className="pt-4 border-t border-vault-border flex justify-end">
          <button
            type="submit"
            disabled={submitting || previewRows.length === 0}
            className="btn btn-primary flex items-center gap-2"
          >
            <Save size={16} />
            {submitting
              ? 'Creating…'
              : `Create ${previewRows.length || 0} SKU${previewRows.length === 1 ? '' : 's'}`}
          </button>
        </div>
      </form>
    </div>
  )
}
