import React, { useEffect, useState } from 'react'
import { CheckCircle, XCircle, X } from 'lucide-react'

export default function Toast({ message, type = 'success', onClose, duration = 4000 }) {
  const [visible, setVisible] = useState(true)

  useEffect(() => {
    const timer = setTimeout(() => {
      setVisible(false)
      setTimeout(onClose, 300)
    }, duration)

    return () => clearTimeout(timer)
  }, [duration, onClose])

  return (
    <div className={`toast ${type === 'success' ? 'toast-success' : 'toast-error'} ${!visible ? 'opacity-0' : ''} transition-opacity`}>
      <div className="flex items-center gap-3">
        {type === 'success' ? (
          <CheckCircle className="text-green-400" size={20} />
        ) : (
          <XCircle className="text-red-400" size={20} />
        )}
        <span>{message}</span>
        <button onClick={() => { setVisible(false); onClose(); }} className="ml-2 text-gray-400 hover:text-white">
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
          onClose={() => removeToast(toast.id)}
        />
      ))}
    </div>
  )
}

// Hook for managing toasts
export function useToast() {
  const [toasts, setToasts] = useState([])

  const addToast = (message, type = 'success') => {
    const id = Date.now()
    setToasts((prev) => [...prev, { id, message, type }])
  }

  const removeToast = (id) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id))
  }

  return { toasts, addToast, removeToast }
}
