// Reload a page that is still running an old build.
//
// F124 (Gary 2026-10-02「发现新版本自动刷新」): a single-page app keeps whatever bundle it loaded until the page is reloaded,
// and route changes never reload it. On 9/12 the app moved to a new database; the Rockets counting device had the app
// open from before the switch, so for 18 days its counts went into the old database and the new books never saw them —
// 94 boxes of RTYH consumption invisible to finance. Nothing on the page said anything was wrong.
//
// So the page compares its own main bundle with the one index.html names now. index.html is served with
// max-age=0 / must-revalidate, so this is the live deployment's answer. When they differ:
//   - no text box on the page holds anything: reload straight away;
//   - any text box holds something (a count being typed, a sale being rung up) — visible tab or not — a red bar says a new
//     version is out, with a reload button. A count is never thrown away by surprise. Deliberately blunt: React keeps
//     defaultValue in step with what was typed, so "changed since load" cannot be read off the DOM (Codex 2026-10-02);
//     a filled search box only costs a bar instead of a silent reload.
//   - if we already reloaded once for this same new build and are still on the old one (an edge serving stale HTML),
//     we do not reload again — the bar instead. No reload loops.
// Checks on load, whenever the tab comes back into view, and every 5 minutes. Offline / fetch errors: try again later.

const BUNDLE_RX = /\/assets\/index-[A-Za-z0-9_-]+\.js/

function currentBundle() {
  for (const s of document.querySelectorAll('script[type="module"][src]')) {
    const m = BUNDLE_RX.exec(s.getAttribute('src') || '')
    if (m) return m[0]
  }
  return null
}

async function liveBundle() {
  const r = await fetch(`/?_v=${Date.now()}`, { cache: 'no-store' })
  if (!r.ok) return null
  const m = BUNDLE_RX.exec(await r.text())
  return m ? m[0] : null
}

function anyTextHeld() {
  for (const el of document.querySelectorAll('input, textarea, [contenteditable="true"]')) {
    if (el.disabled || el.readOnly) continue
    const t = (el.type || '').toLowerCase()
    if (['hidden', 'checkbox', 'radio', 'button', 'submit', 'reset', 'file', 'range', 'color'].includes(t)) continue
    const v = el.isContentEditable ? el.textContent : el.value
    if (String(v || '').trim() !== '') return true
  }
  return false
}

const RELOAD_KEY = 'lv-stale-reload-target'

// Storage that cannot be read or written means no loop guard — so no automatic reload either, only the bar (Codex r2).
function alreadyTried(live) {
  try { return sessionStorage.getItem(RELOAD_KEY) === live } catch { return true }
}

function markTried(live) {
  try {
    sessionStorage.setItem(RELOAD_KEY, live)
    return sessionStorage.getItem(RELOAD_KEY) === live
  } catch {
    return false
  }
}

function showBar() {
  if (document.getElementById('lv-stale-bar')) return
  const bar = document.createElement('div')
  bar.id = 'lv-stale-bar'
  bar.setAttribute('role', 'alert')
  bar.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:2147483647;background:#b91c1c;color:#fff;' +
    'font:600 14px/1.4 system-ui,sans-serif;padding:10px 16px;display:flex;gap:12px;align-items:center;justify-content:center;flex-wrap:wrap'
  const msg = document.createElement('span')
  msg.textContent = 'A new version of the app is out. Finish or note what you are entering, then reload — this page may be saving to the wrong place.'
  const btn = document.createElement('button')
  btn.type = 'button'
  btn.textContent = 'Reload now'
  btn.style.cssText = 'background:#fff;color:#b91c1c;border:0;border-radius:6px;padding:6px 14px;font:700 14px system-ui,sans-serif;cursor:pointer'
  btn.addEventListener('click', () => window.location.reload())
  bar.append(msg, btn)
  document.body.appendChild(bar)
}

export function startStaleBundleWatch({ intervalMs = 5 * 60 * 1000 } = {}) {
  if (import.meta.env.DEV) return
  const mine = currentBundle()
  if (!mine) return                    // cannot tell which build this is: do nothing rather than reload in a loop
  let busy = false
  const check = async () => {
    if (busy) return
    busy = true
    try {
      const live = await liveBundle()
      if (live && live !== mine) {
        if (!anyTextHeld() && !alreadyTried(live) && markTried(live)) {
          window.location.reload()
          return
        }
        showBar()
      }
    } catch {
      // offline or the request failed: the next check tries again
    } finally {
      busy = false
    }
  }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check() })
  window.addEventListener('focus', check)
  setInterval(check, intervalMs)
  check()
}
