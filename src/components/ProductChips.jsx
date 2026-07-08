// Shared product chips — compact brand "logo" chip + language chip (Gary 2026-07-06 for
// StreamCounts; extended to ViewInventory 2026-07-07 so the inventory list distinguishes
// EN/JP/CN the same way the counting UI does). Pure RENDER-time decoration from the existing
// product.brand / product.language fields — no input/data changes. Official logos live in
// public/brands/. Unknown brands fall back to a compact colored initial chip.
import React from 'react'

const BRAND_LOGO = {
  'pokemon': '/brands/pokemon.svg',
  'one piece': '/brands/onepiece.png',
  'yu-gi-oh': '/brands/yugioh.png',
  'dragon ball': '/brands/dragonball.png',
}

export const BrandChip = ({ brand }) => {
  const key = (brand || '').toLowerCase()
  const logo = BRAND_LOGO[key]
  if (logo) {
    // white pill behind the mark — several official logos are dark-on-transparent and
    // would vanish on the app's dark background
    return (
      <span title={brand} className="inline-flex items-center justify-center bg-white/90 rounded px-1 py-0.5 shrink-0">
        <img src={logo} alt={brand} className="h-4 w-auto max-w-[70px] object-contain" loading="lazy" />
      </span>
    )
  }
  return (
    <span title={brand || 'Unknown'}
      className="inline-flex items-center justify-center w-6 h-6 rounded-full text-[10px] font-bold text-white shrink-0 bg-gray-600">
      {(brand || '?').slice(0, 2).toUpperCase()}
    </span>
  )
}

const LANG_CHIP = {
  EN: 'bg-sky-600/80', JP: 'bg-amber-500/90 text-black', CN: 'bg-rose-600/80',
}

export const LangChip = ({ lang }) => {
  const l = (lang || '').toUpperCase().slice(0, 2)
  if (!l) return null
  return (
    <span className={`ml-2 px-1.5 py-0.5 rounded text-[10px] font-bold text-white align-middle ${LANG_CHIP[l] || 'bg-gray-600'}`}>
      {l}
    </span>
  )
}
