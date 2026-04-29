import React, { useState } from 'react'
import { HelpCircle, ChevronDown, ChevronUp } from 'lucide-react'

export default function Instructions({ title = "Instructions", children }) {
  const [isOpen, setIsOpen] = useState(false)

  return (
    <div className="mb-4">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 text-sm text-gray-400 hover:text-vault-gold transition-colors"
      >
        <HelpCircle size={16} />
        <span>{title}</span>
        {isOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
      </button>
      
      {isOpen && (
        <div className="mt-3 p-4 bg-vault-dark border border-vault-border rounded-lg text-sm">
          {children}
        </div>
      )}
    </div>
  )
}
