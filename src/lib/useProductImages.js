import { useState, useEffect } from 'react'
import { fetchProductImageMap } from './supabase'

// Shared product-thumbnail data source.
// ---------------------------------------------------------------------------
// Product thumbnails keyed by the FIRST 8 chars of products.id →
// { "<uuid8>": "<https image url>" }. TWO sources are merged:
//   1. the kaitori pipeline JSON (Shopify + hand-curated overrides), refreshed
//      nightly and served CORS-enabled for this origin, and
//   2. the LIVE `products.image_url` column (images uploaded from Add Product),
//      which WINS on conflict so a just-uploaded image beats the nightly one.
// Fetched once per session; ANY failure (network / CORS / bad JSON / missing
// column) degrades to an EMPTY map for that source so pages render exactly as
// before. Products absent from the merged map show no image.
const IMAGES_URL = 'https://lv-slabs.luckyvault.us/kaitori/product_images.json'

// Module-level cache of the in-flight / resolved fetch promise. Shared across
// every hook consumer so N pages / N mounts trigger exactly ONE fetch per
// session — the failure case is cached too (as {}), keeping it to one hit.
let imagesPromise = null

function loadProductImages() {
  if (!imagesPromise) {
    const kaitori = fetch(IMAGES_URL)
      .then(res => (res.ok ? res.json() : null))
      .then(map => (map && typeof map === 'object' ? map : {}))
      .catch(() => ({})) // silent — pages render unchanged, with no thumbnails
    const uploaded = fetchProductImageMap() // already {} on any failure
    imagesPromise = Promise.all([kaitori, uploaded])
      // uploaded (Supabase image_url) spread LAST so it overrides kaitori.
      .then(([k, u]) => ({ ...k, ...u }))
      .catch(() => ({}))
  }
  return imagesPromise
}

// Hook: returns the product-images map (keyed by uuid-8). Starts as {} and, on
// mount, resolves to the shared fetch (or {} on any failure). Cancel-flag on
// unmount so a late resolve never sets state on an unmounted component. Safe to
// call from many pages / many rows — the underlying fetch happens once.
export default function useProductImages() {
  const [images, setImages] = useState({})
  useEffect(() => {
    let cancelled = false
    loadProductImages().then(map => {
      if (!cancelled) setImages(map)
    })
    return () => { cancelled = true }
  }, [])
  return images
}
