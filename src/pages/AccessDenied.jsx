import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/AuthContext'
import { ShieldX, ArrowLeft, KeyRound, LogOut } from 'lucide-react'

// Human label for each path so the button copy stays meaningful when we
// auto-route to whichever page the user actually has permission for. Keep
// in sync with the sidebar in Layout.jsx.
const PATH_LABELS = {
  '/': 'Dashboard',
  '/inventory': 'View Inventory',
  '/purchased-items': 'Purchased Items',
  '/intake': 'Intake to Master',
  '/manual-inventory': 'Manual Inventory',
  '/storefront-import': 'Storefront Import',
  '/add-product': 'Add Product',
  '/move-inventory': 'Move Inventory',
  '/break-box': 'Break Box',
  '/stream-counts': 'Stream Counts',
  '/stream-sessions': 'Session History',
  '/platform-sales': 'Platform Sales',
  '/online-orders': 'Online Orders',
  '/storefront-sale': 'Storefront Sales',
  '/reports': 'Reports',
  '/turnover': 'Turnover',
  '/executive-report': 'Executive Report',
  '/audit-history': 'Audit History',
  '/high-value': 'High Value',
  '/expenses': 'Business Expenses',
  '/audit': 'Sales Audit',
  '/users': 'Team Management',
}

export default function AccessDenied() {
  const navigate = useNavigate()
  const { user, verifyAdminPin, logout } = useAuth()
  const [showOverride, setShowOverride] = useState(false)
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  // Pick a page the current user actually has access to. Without this the
  // "Go to Dashboard" button looped users through Access Denied → '/' →
  // Access Denied when their allowed_pages didn't include '/'.
  const safeTarget = (() => {
    const allowed = user?.allowed_pages || []
    if (allowed.includes('/')) return '/'
    return allowed[0] || null
  })()
  const safeTargetLabel = safeTarget ? (PATH_LABELS[safeTarget] || safeTarget) : null

  const handlePinChange = (e) => {
    const value = e.target.value.replace(/\D/g, '').slice(0, 4)
    setPin(value)
    setError('')
  }

  const handleOverride = async () => {
    if (pin.length !== 4) {
      setError('Enter 4-digit admin PIN')
      return
    }

    setLoading(true)
    const isValid = await verifyAdminPin(pin)
    setLoading(false)

    if (isValid) {
      // Grant temporary access - just go back in history or to dashboard
      navigate(-1)
    } else {
      setError('Invalid admin PIN')
      setPin('')
    }
  }

  const handleLogout = () => {
    logout()
    // logout() clears the user; the route re-renders as <Login /> via
    // ProtectedRoute. No explicit navigate needed.
  }

  return (
    <div className="min-h-screen bg-vault-darker flex items-center justify-center p-4">
      <div className="w-full max-w-md text-center">
        {/* Icon */}
        <div className="w-20 h-20 bg-red-500/20 rounded-full flex items-center justify-center mx-auto mb-6">
          <ShieldX className="text-red-400" size={40} />
        </div>

        {/* Message */}
        <h1 className="font-display text-2xl font-bold text-white mb-2">Access Denied</h1>
        <p className="text-gray-400 mb-8">
          {user?.name && <>Signed in as <span className="text-white font-medium">{user.name}</span>.<br /></>}
          You don't have permission to access this page.<br />
          Contact your administrator for access.
        </p>

        {/* Actions */}
        <div className="space-y-3">
          {safeTarget ? (
            <button
              onClick={() => navigate(safeTarget)}
              className="btn btn-primary w-full"
            >
              <ArrowLeft size={18} /> Go to {safeTargetLabel}
            </button>
          ) : (
            // Edge case: user has zero allowed pages. Only sensible action
            // is to log out and get a different account.
            <div className="text-xs text-yellow-300 bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-3">
              This account has no pages assigned. Log out and sign in as
              someone with access, or ask your admin to grant permissions.
            </div>
          )}

          <button
            onClick={() => setShowOverride(!showOverride)}
            className="btn btn-secondary w-full"
          >
            <KeyRound size={18} /> Admin Override
          </button>

          <button
            onClick={handleLogout}
            className="w-full py-2 text-sm text-gray-400 hover:text-red-400 transition-colors flex items-center justify-center gap-2"
          >
            <LogOut size={14} /> Log out and sign in as someone else
          </button>
        </div>

        {/* Admin Override Panel */}
        {showOverride && (
          <div className="mt-6 p-4 bg-vault-surface border border-vault-border rounded-xl">
            <p className="text-gray-400 text-sm mb-4">Enter admin PIN to bypass</p>
            
            <div className="flex gap-2 mb-3">
              <input
                type="password"
                value={pin}
                onChange={handlePinChange}
                placeholder="••••"
                className="flex-1 text-center text-xl tracking-widest"
                maxLength={4}
                autoFocus
              />
              <button
                onClick={handleOverride}
                disabled={pin.length !== 4 || loading}
                className="btn btn-primary px-6"
              >
                {loading ? '...' : 'Verify'}
              </button>
            </div>

            {error && (
              <p className="text-red-400 text-sm">{error}</p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
