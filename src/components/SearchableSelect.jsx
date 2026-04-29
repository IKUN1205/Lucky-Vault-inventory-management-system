import React, { useState, useRef, useEffect } from 'react'
import { Search, X } from 'lucide-react'

export default function SearchableSelect({ 
  options = [], 
  value, 
  onChange, 
  placeholder = "Type to search...",
  renderOption = null,
  getOptionLabel = null,
  getOptionValue = (opt) => opt.id,
  className = "",
  disabled = false
}) {
  const [isOpen, setIsOpen] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const wrapperRef = useRef(null)
  const inputRef = useRef(null)

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target)) {
        setIsOpen(false)
        setSearchTerm('')
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Improved fuzzy search - matches any part of words
  const matchesSearch = (option, search) => {
    if (!search) return true
    
    const searchLower = search.toLowerCase().trim()
    const searchTerms = searchLower.split(/\s+/) // Split by spaces for multi-word search
    
    // Get the label text to search against
    let labelText = ''
    if (getOptionLabel) {
      labelText = getOptionLabel(option).toLowerCase()
    } else if (typeof option === 'object') {
      // Search across key fields: name, brand, category, language
      const searchableFields = ['name', 'brand', 'category', 'language', 'label']
      labelText = searchableFields
        .map(field => option[field] || (option.product && option.product[field]) || '')
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
    } else {
      labelText = String(option).toLowerCase()
    }
    
    // All search terms must match somewhere in the label
    return searchTerms.every(term => labelText.includes(term))
  }

  // Filter options based on search term
  const filteredOptions = options.filter(option => matchesSearch(option, searchTerm))

  // Get selected option
  const selectedOption = value ? options.find(opt => getOptionValue(opt) === value) : null

  // Get display label
  const getLabel = (option) => {
    if (!option) return ''
    if (getOptionLabel) return getOptionLabel(option)
    if (typeof option === 'object') return option.name || option.label || ''
    return String(option)
  }

  const handleSelect = (option) => {
    onChange(getOptionValue(option))
    setSearchTerm('')
    setIsOpen(false)
  }

  const handleClear = (e) => {
    e.stopPropagation()
    onChange('')
    setSearchTerm('')
    inputRef.current?.focus()
  }

  const handleInputChange = (e) => {
    setSearchTerm(e.target.value)
    if (!isOpen) setIsOpen(true)
  }

  const handleFocus = () => {
    setIsOpen(true)
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Escape') {
      setIsOpen(false)
      setSearchTerm('')
    }
    if (e.key === 'Enter' && filteredOptions.length > 0) {
      e.preventDefault()
      handleSelect(filteredOptions[0])
    }
  }

  return (
    <div ref={wrapperRef} className={`relative ${className}`}>
      {/* Input */}
      <div className={`relative flex items-center ${disabled ? 'opacity-50 pointer-events-none' : ''}`}>
        <Search size={16} className="absolute left-3 text-gray-500 pointer-events-none" />
        <input
          ref={inputRef}
          type="text"
          value={isOpen ? searchTerm : (selectedOption ? getLabel(selectedOption) : '')}
          onChange={handleInputChange}
          onFocus={handleFocus}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          className="w-full pl-9 pr-8 py-2 bg-vault-dark border border-vault-border rounded-lg text-white placeholder-gray-500 text-sm focus:border-vault-gold focus:ring-1 focus:ring-vault-gold/30 outline-none"
        />
        {(value || searchTerm) && (
          <button
            type="button"
            onClick={handleClear}
            className="absolute right-2 text-gray-500 hover:text-white p-1"
          >
            <X size={14} />
          </button>
        )}
      </div>

      {/* Dropdown */}
      {isOpen && (
        <div className="absolute z-50 w-full mt-1 bg-vault-surface border border-vault-border rounded-lg shadow-xl max-h-60 overflow-y-auto">
          {filteredOptions.length === 0 ? (
            <div className="px-3 py-3 text-gray-500 text-sm text-center">
              {searchTerm ? `No results for "${searchTerm}"` : 'Type to search...'}
            </div>
          ) : (
            filteredOptions.slice(0, 50).map((option, index) => {
              const optValue = getOptionValue(option)
              const isSelected = optValue === value
              
              return (
                <div
                  key={optValue || index}
                  onClick={() => handleSelect(option)}
                  className={`px-3 py-2 cursor-pointer text-sm border-b border-vault-border/50 last:border-0 transition-colors ${
                    isSelected 
                      ? 'bg-vault-gold/20 text-vault-gold' 
                      : 'text-gray-300 hover:bg-vault-dark hover:text-white'
                  }`}
                >
                  {renderOption ? renderOption(option) : getLabel(option)}
                </div>
              )
            })
          )}
          {filteredOptions.length > 50 && (
            <div className="px-3 py-2 text-gray-500 text-xs text-center border-t border-vault-border">
              Showing first 50 of {filteredOptions.length} results. Type more to narrow down.
            </div>
          )}
        </div>
      )}
    </div>
  )
}
