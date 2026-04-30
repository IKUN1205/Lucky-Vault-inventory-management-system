import React, { useEffect, useState } from 'react'
import { CheckCircle, XCircle, X, Undo2 } from 'lucide-react'

/**
 * Toast notification.
 *
 * Props:
 *   message  — text to show
 *   type     — 'success' | 'error' | 'info'
 *   onClose  — callback when toast dismisses
 *   duration — ms before auto-dismiss (default 4000; 8000 if action present)
 *   action   — optional { label, onClick } — renders an action button
 *              (e.g. Undo). Clicking it fires onClick then dismisses the toast.
 */
export default function Toast({ message, type = 'success', onClose, duration, action }) {
  const [visible, setVisible] = useState(true)
  const [actionFired, setActionFired] = useState(false)

  // Give the user a bit longer to react when there's an undo button
  const effectiveDuration = duration ?? (action ? 8000 : 4000)

  useEffect(() => {
    const timer = setTimeout(() => {
      setVisible(false)
      setTimeout(onClose, 300)
    }, effectiveDuration)

    return () => clearTimeout(timer)
  }, [effectiveDuration, onClose])

  const handleAction = async () => {
    if (actionFired) return
    setActionFired(true)
    try {
      await action.onClick()
    } catch (err) {
      console.error('Toast action failed:', err)
    }
    setVisible(false)
    setTimeout(onClose, 300)
  }

  return (
    <div className={`toast ${type === 'success' ? 'toast-success' : type === 'error' ? 'toast-error' : 'toast-success'} ${!visible ? 'opacity-0' : ''} transition-opacity`}>
      <div className="flex items-center gap-3">
        {type === 'success' ? (
          <CheckCircle className="text-green-400 flex-shrink-0" size={20} />
        ) : type === 'error' ? (
          <XCircle className="text-red-400 flex-shrink-0" size={20} />
        ) : (
          <CheckCircle className="text-blue-400 flex-shrink-0" size={20} />
        )}
        <span className="flex-1">{message}</span>
        {action && (
          <button
            onClick={handleAction}
            disabled={actionFired}
            className="flex items-center gap-1 px-2 py-1 ml-1 text-xs font-medium rounded bg-vault-gold/20 text-vault-gold hover:bg-vault-gold/30 disabled:opacity-50 disabled:cursor-not-allowed"
            aria-label={action.label}
          >
            <Undo2 size={14} />
            {actionFired ? 'Undoing…' : action.label}
          </button>
        )}
        <button
          onClick={() => { setVisible(false); onClose(); }}
          className="ml-1 text-gray-400 hover:text-white flex-shrink-0"
          aria-label="Close"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  )
}

// Toast container to manage multiple toasts
export function ToastContainer({ toasts, removeToast }) {
  return (
    <div className="fixed bottom-4 right-4 space-y-2 z-50">
      {toasts.map((toast) => (
        <Toast
          key={toast.id}
          message={toast.message}
          type={toast.type}
          duration={toast.duration}
          action={toast.action}
          onClose={() => removeToast(toast.id)}
        />
      ))}
    </div>
  )
}

// Hook for managing toasts
export function useToast() {
  const [toasts, setToasts] = useState([])

  /**
   * addToast(message, type, options?)
   *   options.action   — { label, onClick } for an undo-style button
   *   options.duration — override auto-dismiss ms
   *
   * Backwards compatible: addToast('hi') and addToast('oops', 'error') still work.
   */
  const addToast = (message, type = 'success', options = {}) => {
    const id = Date.now() + Math.random()
    setToasts((prev) => [...prev, {
      id,
      message,
      type,
      action: options.action,
      duration: options.duration,
    }])
  }

  const removeToast = (id) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id))
  }

  return { toasts, addToast, removeToast }
}
