import React, { useState, useEffect } from 'react'
import { supabase, convertToUSD } from '../lib/supabase'
import { ToastContainer, useToast } from '../components/Toast'
import Instructions from '../components/Instructions'
import { Receipt, Truck, Building, Zap, Utensils, Plane, MoreHorizontal, Save, DollarSign, Plus, X } from 'lucide-react'

const EXPENSE_CATEGORIES = [
  { id: 'shipping', name: 'Shipping', icon: Truck, color: 'text-blue-400' },
  { id: 'office', name: 'Office', icon: Building, color: 'text-purple-400' },
  { id: 'utilities', name: 'Utilities', icon: Zap, color: 'text-yellow-400' },
  { id: 'food', name: 'Food & Meals', icon: Utensils, color: 'text-green-400' },
  { id: 'travel', name: 'Travel', icon: Plane, color: 'text-orange-400' },
  { id: 'other', name: 'Other', icon: MoreHorizontal, color: 'text-gray-400' }
]

export default function BusinessExpenses() {
  const { toasts, addToast, removeToast } = useToast()
  
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [expenses, setExpenses] = useState([])
  const [paymentMethods, setPaymentMethods] = useState([])
  const [showNewPayment, setShowNewPayment] = useState(false)
  const [newPaymentName, setNewPaymentName] = useState('')

  const [form, setForm] = useState({
    date: new Date().toISOString().split('T')[0],
    category: '',
    amount: '',
    currency: 'USD',
    payment_method_id: '',
    description: '',
    notes: ''
  })

  useEffect(() => {
    loadData()
  }, [])

  const loadData = async () => {
    try {
      // Fetch payment methods
      const { data: pmData } = await supabase
        .from('payment_methods')
        .select('*')
        .eq('active', true)
        .order('name')
      setPaymentMethods(pmData || [])

      // Fetch recent expenses with payment method info
      const { data: expData } = await supabase
        .from('business_expenses')
        .select('*, payment_method:payment_methods(name)')
        .order('date', { ascending: false })
        .order('created_at', { ascending: false })
      setExpenses(expData || [])
    } catch (error) {
      console.error('Error loading data:', error)
      addToast('Failed to load data', 'error')
    } finally {
      setLoading(false)
    }
  }

  const handleChange = (e) => {
    const { name, value } = e.target
    setForm(f => ({ ...f, [name]: value }))
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    
    if (!form.category || !form.amount || !form.description) {
      addToast('Please fill all required fields', 'error')
      return
    }

    setSubmitting(true)

    try {
      const amount = parseFloat(form.amount)
      const amountUsd = convertToUSD(amount, form.currency)

      const { error } = await supabase
        .from('business_expenses')
        .insert({
          date: form.date,
          category: form.category,
          amount: amount,
          currency: form.currency,
          amount_usd: amountUsd,
          payment_method_id: form.payment_method_id || null,
          description: form.description,
          notes: form.notes || null
        })

      if (error) throw error

      addToast('Expense recorded successfully!')
      setForm({
        date: new Date().toISOString().split('T')[0],
        category: '',
        amount: '',
        currency: 'USD',
        payment_method_id: '',
        description: '',
        notes: ''
      })
      loadData()
    } catch (error) {
      console.error('Error recording expense:', error)
      addToast('Failed to record expense', 'error')
    } finally {
      setSubmitting(false)
    }
  }

  const getCategoryInfo = (catId) => {
    return EXPENSE_CATEGORIES.find(c => c.id === catId) || EXPENSE_CATEGORIES[5]
  }

  const handleAddPaymentMethod = async () => {
    if (!newPaymentName.trim()) return
    try {
      const { data, error } = await supabase
        .from('payment_methods')
        .insert({ name: newPaymentName.trim() })
        .select()
        .single()
      
      if (error) throw error
      
      setPaymentMethods([...paymentMethods, data])
      setForm(f => ({ ...f, payment_method_id: data.id }))
      setShowNewPayment(false)
      setNewPaymentName('')
      addToast('Payment method added')
    } catch (error) {
      addToast('Failed to add payment method', 'error')
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="spinner"></div>
      </div>
    )
  }

  return (
    <div className="fade-in">
      <ToastContainer toasts={toasts} removeToast={removeToast} />
      
      <div className="mb-6">
        <h1 className="font-display text-2xl font-bold text-white flex items-center gap-3">
          <Receipt className="text-purple-400" />
          Business Expenses
        </h1>
        <p className="text-gray-400 mt-1">Track business expenses by category</p>
      </div>

      <Instructions>
        <div className="space-y-3 text-gray-300">
          <p className="font-medium text-white">Record a business expense:</p>
          <ol className="list-decimal list-inside space-y-2 ml-2">
            <li>Enter the <span className="text-vault-gold">date</span></li>
            <li>Enter the <span className="text-vault-gold">amount</span> and select currency</li>
            <li>Select a <span className="text-vault-gold">category</span> (Shipping, Office, Utilities, etc.)</li>
            <li>Select <span className="text-vault-gold">payment method</span></li>
            <li>Add a <span className="text-vault-gold">description</span></li>
            <li>Click <span className="text-vault-gold">Save Expense</span></li>
          </ol>
          <p className="text-purple-400 text-xs mt-3">💡 Expenses appear in Reports for tracking spending</p>
        </div>
      </Instructions>

      {/* Add Expense Form */}
      <form onSubmit={handleSubmit} className="card mb-6">
        <h2 className="font-display text-lg font-semibold text-white mb-4">Record Expense</h2>
        
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4 mb-4">
          {/* Date */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">Date *</label>
            <input
              type="date"
              name="date"
              value={form.date}
              onChange={handleChange}
              required
            />
          </div>

          {/* Amount */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">Amount *</label>
            <input
              type="number"
              name="amount"
              value={form.amount}
              onChange={handleChange}
              min="0"
              step="0.01"
              placeholder="0.00"
              required
            />
          </div>

          {/* Currency */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">Currency *</label>
            <select
              name="currency"
              value={form.currency}
              onChange={handleChange}
              required
            >
              <option value="USD">USD ($)</option>
              <option value="JPY">JPY (¥)</option>
              <option value="RMB">RMB (¥)</option>
            </select>
          </div>

          {/* Payment Method */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">Payment Method</label>
            {showNewPayment ? (
              <div className="flex gap-2">
                <input 
                  type="text" 
                  value={newPaymentName} 
                  onChange={(e) => setNewPaymentName(e.target.value)} 
                  placeholder="Payment method name" 
                  className="flex-1" 
                />
                <button type="button" onClick={handleAddPaymentMethod} className="btn btn-primary p-2"><Save size={18} /></button>
                <button type="button" onClick={() => setShowNewPayment(false)} className="btn btn-secondary p-2"><X size={18} /></button>
              </div>
            ) : (
              <div className="flex gap-2">
                <select
                  name="payment_method_id"
                  value={form.payment_method_id}
                  onChange={handleChange}
                  className="flex-1"
                >
                  <option value="">Select payment method...</option>
                  {paymentMethods.map(pm => (
                    <option key={pm.id} value={pm.id}>{pm.name}</option>
                  ))}
                </select>
                <button type="button" onClick={() => setShowNewPayment(true)} className="btn btn-secondary p-2"><Plus size={18} /></button>
              </div>
            )}
          </div>

          {/* Description */}
          <div className="lg:col-span-2">
            <label className="block text-sm font-medium text-gray-300 mb-2">Description *</label>
            <input
              type="text"
              name="description"
              value={form.description}
              onChange={handleChange}
              placeholder="What was this expense for?"
              required
            />
          </div>
        </div>

        {/* Category Selection */}
        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-300 mb-2">Category *</label>
          <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
            {EXPENSE_CATEGORIES.map(cat => {
              const Icon = cat.icon
              return (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => setForm(f => ({ ...f, category: cat.id }))}
                  className={`p-3 rounded-lg border-2 transition-all text-center ${
                    form.category === cat.id
                      ? 'border-vault-gold bg-vault-gold/10'
                      : 'border-vault-border bg-vault-dark hover:border-gray-500'
                  }`}
                >
                  <Icon className={`mx-auto mb-1 ${form.category === cat.id ? 'text-vault-gold' : cat.color}`} size={20} />
                  <p className={`text-xs font-medium ${form.category === cat.id ? 'text-vault-gold' : 'text-gray-400'}`}>
                    {cat.name}
                  </p>
                </button>
              )
            })}
          </div>
        </div>

        {/* Notes */}
        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-300 mb-2">Notes</label>
          <textarea
            name="notes"
            value={form.notes}
            onChange={handleChange}
            rows={2}
            placeholder="Additional details..."
          />
        </div>

        {/* Submit */}
        <button 
          type="submit" 
          className="btn btn-primary"
          disabled={submitting || !form.category || !form.amount}
        >
          {submitting ? (
            <div className="spinner w-5 h-5 border-2"></div>
          ) : (
            <>
              <Save size={20} />
              Record Expense
            </>
          )}
        </button>
      </form>

      {/* Expense Log Table */}
      <div className="card">
        <h2 className="font-display text-lg font-semibold text-white mb-4">Expense Log</h2>
        
        {expenses.length === 0 ? (
          <div className="text-center py-8">
            <DollarSign className="mx-auto text-gray-600 mb-4" size={48} />
            <p className="text-gray-400">No expenses recorded yet</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Category</th>
                  <th className="text-right">Amount</th>
                  <th>Currency</th>
                  <th>Payment Method</th>
                  <th>Description</th>
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                {expenses.map(exp => {
                  const catInfo = getCategoryInfo(exp.category)
                  return (
                    <tr key={exp.id}>
                      <td className="text-gray-300 whitespace-nowrap">{exp.date}</td>
                      <td>
                        <span className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium ${
                          exp.category === 'shipping' ? 'bg-blue-500/20 text-blue-400' :
                          exp.category === 'office' ? 'bg-purple-500/20 text-purple-400' :
                          exp.category === 'utilities' ? 'bg-yellow-500/20 text-yellow-400' :
                          exp.category === 'food' ? 'bg-green-500/20 text-green-400' :
                          exp.category === 'travel' ? 'bg-orange-500/20 text-orange-400' :
                          'bg-gray-500/20 text-gray-400'
                        }`}>
                          {catInfo.name}
                        </span>
                      </td>
                      <td className="text-right text-vault-gold font-medium whitespace-nowrap">
                        ${exp.amount_usd?.toFixed(2)}
                      </td>
                      <td className="text-gray-400 whitespace-nowrap">
                        {exp.currency !== 'USD' ? `${exp.amount} ${exp.currency}` : 'USD'}
                      </td>
                      <td className="text-gray-300">{exp.payment_method?.name || '-'}</td>
                      <td className="text-white">{exp.description}</td>
                      <td className="text-gray-500 text-sm max-w-[200px] truncate">{exp.notes || '-'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
