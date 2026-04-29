import React, { useState } from 'react'
import { useAuth } from '../lib/AuthContext'
import { Lock, AlertCircle } from 'lucide-react'

export default function Login() {
  const { login } = useAuth()
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handlePinChange = (e) => {
    const value = e.target.value.replace(/\D/g, '').slice(0, 4)
    setPin(value)
    setError('')
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    
    if (pin.length !== 4) {
      setError('Please enter a 4-digit PIN')
      return
    }

    setLoading(true)
    const result = await login(pin)
    setLoading(false)

    if (!result.success) {
      setError(result.error)
      setPin('')
    }
  }

  const handleKeypadClick = (num) => {
    if (pin.length < 4) {
      const newPin = pin + num
      setPin(newPin)
      setError('')
    }
  }

  const handleBackspace = () => {
    setPin(pin.slice(0, -1))
    setError('')
  }

  const handleClear = () => {
    setPin('')
    setError('')
  }

  return (
    <div className="min-h-screen bg-vault-darker flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        {/* Logo/Header */}
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-gradient-to-br from-vault-gold to-amber-600 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <Lock className="text-vault-dark" size={32} />
          </div>
          <h1 className="font-display text-3xl font-bold text-white">Lucky Vault</h1>
          <p className="text-gray-400 mt-2">Enter your PIN to continue</p>
        </div>

        {/* PIN Display */}
        <div className="bg-vault-surface border border-vault-border rounded-xl p-6 mb-6">
          <div className="flex justify-center gap-3 mb-6">
            {[0, 1, 2, 3].map((i) => (
              <div
                key={i}
                className={`w-12 h-14 rounded-lg border-2 flex items-center justify-center text-2xl font-bold transition-all ${
                  pin.length > i
                    ? 'border-vault-gold bg-vault-gold/10 text-vault-gold'
                    : 'border-vault-border bg-vault-dark text-gray-600'
                }`}
              >
                {pin.length > i ? '●' : ''}
              </div>
            ))}
          </div>

          {/* Error Message */}
          {error && (
            <div className="flex items-center gap-2 text-red-400 text-sm mb-4 justify-center">
              <AlertCircle size={16} />
              {error}
            </div>
          )}

          {/* Keypad */}
          <div className="grid grid-cols-3 gap-3">
            {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((num) => (
              <button
                key={num}
                type="button"
                onClick={() => handleKeypadClick(num.toString())}
                className="h-14 rounded-lg bg-vault-dark border border-vault-border text-white text-xl font-semibold hover:bg-vault-gold hover:text-vault-dark hover:border-vault-gold transition-all"
              >
                {num}
              </button>
            ))}
            <button
              type="button"
              onClick={handleClear}
              className="h-14 rounded-lg bg-vault-dark border border-vault-border text-gray-400 text-sm font-medium hover:bg-red-500/20 hover:text-red-400 hover:border-red-500/30 transition-all"
            >
              Clear
            </button>
            <button
              type="button"
              onClick={() => handleKeypadClick('0')}
              className="h-14 rounded-lg bg-vault-dark border border-vault-border text-white text-xl font-semibold hover:bg-vault-gold hover:text-vault-dark hover:border-vault-gold transition-all"
            >
              0
            </button>
            <button
              type="button"
              onClick={handleBackspace}
              className="h-14 rounded-lg bg-vault-dark border border-vault-border text-gray-400 text-sm font-medium hover:bg-vault-surface hover:text-white transition-all"
            >
              ←
            </button>
          </div>

          {/* Login Button */}
          <button
            onClick={handleSubmit}
            disabled={pin.length !== 4 || loading}
            className={`w-full mt-6 py-3 rounded-lg font-semibold transition-all ${
              pin.length === 4 && !loading
                ? 'bg-vault-gold text-vault-dark hover:bg-amber-400'
                : 'bg-vault-border text-gray-500 cursor-not-allowed'
            }`}
          >
            {loading ? (
              <div className="flex items-center justify-center gap-2">
                <div className="w-5 h-5 border-2 border-vault-dark border-t-transparent rounded-full animate-spin"></div>
                Verifying...
              </div>
            ) : (
              'Login'
            )}
          </button>
        </div>

        {/* Footer */}
        <p className="text-center text-gray-600 text-sm">
          Contact your administrator if you forgot your PIN
        </p>
      </div>
    </div>
  )
}
