import { useState, useEffect } from 'react'

// Shared product-thumbnail data source.
// ---------------------------------------------------------------------------
// Product thumbnails keyed by the FIRST 8 chars of products.id →
// { "<uuid8>": "<https image url>" }. Served by the kaitori pipeline
// (CORS-enabled for this origin), refreshed nightly. Fetched once per session;
// ANY failure (network / CORS / bad JSON) degrades to an EMPTY map so pages
// render exactly as before with no error shown. Products absent from the map
// show no image. This is the exact logic ViewInventory used inline, lifted out
// so every operational page can share it (and the fetch).
const IMAGES_URL = 'https://lv-slabs.luckyvault.us/kaitori/product_images.json'

// Module-level cache of the in-flight / resolved fetch promise. Shared across
// every hook consumer so N pages / N mounts trigger exactly ONE network fetch
// per session — the failure case is cached too (as {}), keeping it to one hit.
let imagesPromise = null

function loadProductImages() {
  if (!imagesPromise) {
    imagesPromise = fetch(IMAGES_URL)
      .then(res => (res.ok ? res.json() : null))
      .then(map => (map && typeof map === 'object' ? map : {}))
      .catch(() => ({})) // silent — pages render unchanged, with no thumbnails
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
