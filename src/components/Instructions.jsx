import React, { useState } from 'react'
import { HelpCircle, ChevronDown, ChevronUp, X } from 'lucide-react'

export default function Instructions({ children }) {
  const [isOpen, setIsOpen] = useState(false)

  return (
    <div className="mb-4">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-3 py-1.5 text-sm bg-vault-surface border border-vault-border rounded-lg text-gray-300 hover:text-vault-gold hover:border-vault-gold transition-colors"
      >
        <HelpCircle size={16} />
        <span>Instructions</span>
        {isOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </button>
      
      {isOpen && (
        <div className="mt-3 p-4 bg-vault-dark border border-vault-border rounded-lg text-sm relative">
          <button 
            onClick={() => setIsOpen(false)}
            className="absolute top-2 right-2 text-gray-500 hover:text-white"
          >
            <X size={16} />
          </button>
          {children}
        </div>
      )}
    </div>
  )
}
