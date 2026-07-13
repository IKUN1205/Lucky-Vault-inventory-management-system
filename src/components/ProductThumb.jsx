import React from 'react'
import useProductImages from '../lib/useProductImages'

// Shared product thumbnail — the exact pattern first shipped on View Inventory,
// extracted so every operational page can show it. Looks the product up by the
// FIRST 8 chars of its UUID in the kaitori image map (see useProductImages),
// then renders a small lazy <img> linking to the full-size image. Renders
// NOTHING (null) when there's no product, no image entry, or a non-https URL.
//
// Display-only: it never touches data, counts, or submit logic — safe to drop
// next to any product name.
//
// Props:
//   productId — product UUID string (or undefined/null → renders null)
//   size      — square px size of the thumb (default 40, matching ViewInventory)
export default function ProductThumb({ productId, size = 40 }) {
  const images = useProductImages()
  if (!productId) return null

  const raw = images[String(productId).slice(0, 8)]
  // https-only guard: the map is remote JSON — never let a malformed or
  // compromised value become a javascript: href.
  let imgSrc = null
  try { if (raw && new URL(raw).protocol === 'https:') imgSrc = raw } catch { /* not a URL — no thumb */ }
  if (!imgSrc) return null

  return (
    <a href={imgSrc} target="_blank" rel="noreferrer" title="Open image full size">
      <img
        src={imgSrc}
        alt=""
        loading="lazy"
        className="object-cover rounded"
        style={{ width: size, height: size }}
        onError={(e) => { e.currentTarget.style.display = 'none' }}
      />
    </a>
  )
}
