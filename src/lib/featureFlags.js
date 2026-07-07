// ============================================================================
// Feature flags — build-time toggles via Vite env vars (VITE_ENABLE_*).
// ============================================================================
// Default OFF: an absent / empty / non-"true" env value → false, so new work
// ships dark until explicitly enabled. Set the var to the string "true" in
// .env.local (or the deploy env) to turn a feature on.
//
//   VITE_ENABLE_CN_JP_FINANCE=true
//
// Referenced from routing (src/App.jsx), the sidebar (src/components/Layout.jsx),
// and the permission registry (src/pages/UserManagement.jsx). Keep the keys
// stable — they are the contract those three files gate on.
// ============================================================================

export const FEATURE_FLAGS = {
  // CN/JP finance additions: China Acquisitions (中国进货) page, the shared
  // slab cert quick-intake, and the fx_transfers CNY-entry form. Relies on the
  // schema in sql/cn_jp_finance.sql being applied first. See
  // CN_JP_FINANCE_RESULT.md for the rollout checklist.
  cnJpFinance: import.meta.env.VITE_ENABLE_CN_JP_FINANCE === 'true',
}

export const isFeatureEnabled = (name) => Boolean(FEATURE_FLAGS[name])
