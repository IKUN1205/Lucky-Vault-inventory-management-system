import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/AuthContext'
import { ShieldX, ArrowLeft, KeyRound } from 'lucide-react'

export default function AccessDenied() {
  const navigate = useNavigate()
  const { verifyAdminPin } = useAuth()
  const [showOverride, setShowOverride] = useState(false)
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

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
          You don't have permission to access this page.<br />
          Contact your administrator for access.
        </p>

        {/* Actions */}
        <div className="space-y-4">
          <button
            onClick={() => navigate('/')}
            className="btn btn-primary w-full"
          >
            <ArrowLeft size={18} /> Go to Dashboard
          </button>

          <button
            onClick={() => setShowOverride(!showOverride)}
            className="btn btn-secondary w-full"
          >
            <KeyRound size={18} /> Admin Override
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
