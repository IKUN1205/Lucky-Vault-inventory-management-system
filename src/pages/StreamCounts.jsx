import React, { useState, useEffect } from 'react'
import { 
  fetchLocations,
  fetchUsers,
  fetchInventoryForRoom,
  createStreamCount,
  createStreamCountItems,
  createUser,
  updateInventory,
  fetchStreamCounts,
  fetchStreamCountItems
} from '../lib/supabase'
import { ToastContainer, useToast } from '../components/Toast'
import Instructions from '../components/Instructions'
import { 
  ClipboardList, 
  Play, 
  Save, 
  AlertTriangle, 
  CheckCircle, 
  Package,
  Clock,
  User,
  ChevronDown,
  ChevronUp,
  History
} from 'lucide-react'

// Helper to extract Launch Name from full product name
const extractLaunchName = (fullName, category) => {
  if (!fullName) return ''
  if (!category) return fullName
  const categoryPattern = new RegExp(`\\s*${category}\\s*$`, 'i')
  return fullName.replace(categoryPattern, '').trim() || fullName
}

// Stream room locations (filter for only these)
const STREAM_ROOM_NAMES = [
  'Stream Room - eBay LuckyVaultUS',
  'Stream Room - eBay SlabbiePatty',
  'Stream Room - TikTok RocketsHQ',
  'Stream Room - TikTok Whatnot',
  'Stream Room - Whatnot Rockets'
]

export default function StreamCounts() {
  const { toasts, addToast, removeToast } = useToast()
  
  // Data
  const [locations, setLocations] = useState([])
  const [users, setUsers] = useState([])
  const [inventory, setInventory] = useState([])
  const [recentCounts, setRecentCounts] = useState([])
  
  // UI State
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [step, setStep] = useState(1) // 1 = select, 2 = count, 3 = report
  const [showHistory, setShowHistory] = useState(false)
  const [expandedReport, setExpandedReport] = useState(null)
  const [expandedReportItems, setExpandedReportItems] = useState([])
  
  // Form State
  const [form, setForm] = useState({
    location_id: '',
    streamer_id: '',
    counted_by_id: '',
    count_time: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }),
    count_date: new Date().toISOString().split('T')[0]
  })
  
  // Count data - maps product_id to actual count
  const [counts, setCounts] = useState({})
  
  // For "Other" user option
  const [showNewStreamer, setShowNewStreamer] = useState(false)
  const [showNewCounter, setShowNewCounter] = useState(false)
  const [newStreamerName, setNewStreamerName] = useState('')
  const [newCounterName, setNewCounterName] = useState('')
  
  // Report data
  const [report, setReport] = useState(null)

  useEffect(() => {
    loadData()
  }, [])

  const loadData = async () => {
    try {
      const [locData, userData, countsData] = await Promise.all([
        fetchLocations('Physical'),
        fetchUsers(),
        fetchStreamCounts(null, null, null)
      ])
      
      // Filter to only stream rooms
      const streamRooms = locData.filter(l => 
        STREAM_ROOM_NAMES.some(name => 
          l.name.toLowerCase() === name.toLowerCase()
        )
      )
      setLocations(streamRooms)
      setUsers(userData)
      setRecentCounts(countsData.slice(0, 10)) // Last 10 counts
    } catch (error) {
      console.error('Error loading data:', error)
      addToast('Failed to load data', 'error')
    } finally {
      setLoading(false)
    }
  }

  const loadInventoryForLocation = async (locationId) => {
    try {
      const invData = await fetchInventoryForRoom(locationId)
      setInventory(invData)
      
      // Pre-fill counts with expected quantities
      const initialCounts = {}
      invData.forEach(inv => {
        initialCounts[inv.product_id] = inv.quantity
      })
      setCounts(initialCounts)
    } catch (error) {
      console.error('Error loading inventory:', error)
      addToast('Failed to load inventory', 'error')
    }
  }

  const handleFormChange = (e) => {
    const { name, value } = e.target
    setForm(f => ({ ...f, [name]: value }))
    
    // Handle "other" selection
    if (name === 'streamer_id' && value === 'other') {
      setShowNewStreamer(true)
    } else if (name === 'streamer_id') {
      setShowNewStreamer(false)
    }
    
    if (name === 'counted_by_id' && value === 'other') {
      setShowNewCounter(true)
    } else if (name === 'counted_by_id') {
      setShowNewCounter(false)
    }
  }

  const handleCountChange = (productId, value) => {
    setCounts(c => ({
      ...c,
      [productId]: value === '' ? '' : parseInt(value) || 0
    }))
  }

  const handleStartCount = async () => {
    // Validate form
    if (!form.location_id) {
      addToast('Please select a stream room', 'error')
      return
    }
    
    // Handle new streamer
    let streamerId = form.streamer_id
    if (showNewStreamer && newStreamerName.trim()) {
      try {
        const newUser = await createUser(newStreamerName.trim())
        streamerId = newUser.id
        setUsers(u => [...u, newUser])
      } catch (error) {
        addToast('Failed to create new user', 'error')
        return
      }
    }
    
    if (!streamerId || streamerId === 'other') {
      addToast('Please select or enter a streamer name', 'error')
      return
    }
    
    // Handle new counter
    let counterId = form.counted_by_id
    if (showNewCounter && newCounterName.trim()) {
      try {
        const existing = users.find(u => u.name.toLowerCase() === newCounterName.trim().toLowerCase())
        if (existing) {
          counterId = existing.id
        } else {
          const newUser = await createUser(newCounterName.trim())
          counterId = newUser.id
          setUsers(u => [...u, newUser])
        }
      } catch (error) {
        addToast('Failed to create new user', 'error')
        return
      }
    }
    
    if (!counterId || counterId === 'other') {
      addToast('Please select or enter who is counting', 'error')
      return
    }
    
    // Update form with resolved IDs
    setForm(f => ({ ...f, streamer_id: streamerId, counted_by_id: counterId }))
    
    // Load inventory for the selected room
    await loadInventoryForLocation(form.location_id)
    
    setStep(2)
  }

  const handleSubmitCount = async () => {
    setSubmitting(true)
    
    try {
      // Build count time from date and time inputs
      // Get local timezone offset and append it so Postgres doesn't convert to UTC
      const localDate = new Date(`${form.count_date}T${form.count_time}:00`)
      const tzOffset = -localDate.getTimezoneOffset()
      const tzHours = Math.floor(Math.abs(tzOffset) / 60).toString().padStart(2, '0')
      const tzMins = (Math.abs(tzOffset) % 60).toString().padStart(2, '0')
      const tzSign = tzOffset >= 0 ? '+' : '-'
      const countTimeString = `${form.count_date}T${form.count_time}:00${tzSign}${tzHours}:${tzMins}`
      
      // Calculate totals and build items
      let totalSold = 0
      let totalDiscrepancies = 0
      const items = []
      
      inventory.forEach(inv => {
        const expected = inv.quantity
        const actual = counts[inv.product_id] ?? inv.quantity
        const diff = actual - expected
        
        if (diff < 0) {
          totalSold += Math.abs(diff)
        } else if (diff > 0) {
          totalDiscrepancies += diff
        }
        
        items.push({
          product_id: inv.product_id,
          expected_qty: expected,
          actual_qty: actual,
          difference: diff
        })
      })
      
      // Create stream count record
      const streamCount = await createStreamCount({
        location_id: form.location_id,
        streamer_id: form.streamer_id,
        counted_by_id: form.counted_by_id,
        count_time: countTimeString,
        status: totalDiscrepancies > 0 ? 'has_discrepancies' : 'complete',
        total_sold: totalSold,
        total_discrepancies: totalDiscrepancies
      })
      
      // Add stream_count_id to items and insert
      const itemsWithId = items.map(item => ({
        ...item,
        stream_count_id: streamCount.id
      }))
      await createStreamCountItems(itemsWithId)
      
      // Update inventory for each changed item
      for (const item of items) {
        if (item.difference !== 0) {
          await updateInventory(
            item.product_id,
            form.location_id,
            item.difference // This will subtract if negative (sold) or add if positive
          )
        }
      }
      
      // Build report
      const soldItems = items
        .filter(i => i.difference < 0)
        .map(i => {
          const inv = inventory.find(inv => inv.product_id === i.product_id)
          return {
            product: inv?.product,
            expected: i.expected_qty,
            actual: i.actual_qty,
            sold: Math.abs(i.difference)
          }
        })
      
      const discrepancyItems = items
        .filter(i => i.difference > 0)
        .map(i => {
          const inv = inventory.find(inv => inv.product_id === i.product_id)
          return {
            product: inv?.product,
            expected: i.expected_qty,
            actual: i.actual_qty,
            extra: i.difference
          }
        })
      
      setReport({
        location: locations.find(l => l.id === form.location_id)?.name,
        streamer: users.find(u => u.id === form.streamer_id)?.name,
        counted_by: users.find(u => u.id === form.counted_by_id)?.name,
        count_time: localDate,
        total_sold: totalSold,
        total_discrepancies: totalDiscrepancies,
        sold_items: soldItems,
        discrepancy_items: discrepancyItems,
        status: totalDiscrepancies > 0 ? 'has_discrepancies' : 'complete'
      })
      
      // Refresh recent counts
      const countsData = await fetchStreamCounts(null, null, null)
      setRecentCounts(countsData.slice(0, 10))
      
      addToast(`Count submitted! ${totalSold} items sold.`, 'success')
      setStep(3)
    } catch (error) {
      console.error('Error submitting count:', error)
      addToast('Failed to submit count', 'error')
    } finally {
      setSubmitting(false)
    }
  }

  const handleNewCount = () => {
    setStep(1)
    setForm({
      location_id: '',
      streamer_id: '',
      counted_by_id: '',
      count_time: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }),
      count_date: new Date().toISOString().split('T')[0]
    })
    setCounts({})
    setReport(null)
    setShowNewStreamer(false)
    setShowNewCounter(false)
    setNewStreamerName('')
    setNewCounterName('')
  }

  const toggleReportExpand = async (countId) => {
    if (expandedReport === countId) {
      setExpandedReport(null)
      setExpandedReportItems([])
    } else {
      setExpandedReport(countId)
      try {
        const items = await fetchStreamCountItems(countId)
        setExpandedReportItems(items)
      } catch (error) {
        console.error('Error loading report items:', error)
      }
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
      
      {/* Header */}
      <div className="mb-6 flex justify-between items-start">
        <div>
          <h1 className="font-display text-2xl font-bold text-white flex items-center gap-3">
            <ClipboardList className="text-vault-gold" />
            Stream Counts
          </h1>
          <p className="text-gray-400 mt-1">Record inventory counts after each stream</p>
        </div>
      </div>

      <Instructions>
        <div className="space-y-3 text-gray-300">
          <p className="font-medium text-white">After each stream ends, log the remaining inventory count:</p>
          <ol className="list-decimal list-inside space-y-2 ml-2">
            <li>Select your <span className="text-vault-gold">Stream Room</span> from the dropdown</li>
            <li>Select <span className="text-vault-gold">Streamer</span> (who ran the stream)</li>
            <li>Select <span className="text-vault-gold">Counted By</span> (who is doing the count)</li>
            <li>Click <span className="text-vault-gold">Start Count</span></li>
            <li>Enter the <span className="text-vault-gold">actual quantity</span> for each product shown</li>
            <li>Click <span className="text-vault-gold">Submit Count</span></li>
          </ol>
          <div className="mt-4 p-3 bg-vault-surface rounded border border-vault-border">
            <p className="font-medium text-white mb-2">What the numbers mean:</p>
            <ul className="space-y-1">
              <li><span className="text-green-400">Expected 10, Actual 7</span> → 3 sold ✓</li>
              <li><span className="text-gray-400">Expected 10, Actual 10</span> → 0 sold</li>
              <li><span className="text-amber-400">Expected 10, Actual 12</span> → +2 discrepancy (report to manager)</li>
            </ul>
          </div>
          <p className="text-amber-400 text-xs mt-3">⚠️ Count IMMEDIATELY after stream ends (within 30 min)</p>
        </div>
      </Instructions>

      {step !== 1 && (
        <div className="mb-4">
          <button onClick={handleNewCount} className="btn btn-secondary">
            New Count
          </button>
        </div>
      )}

      {/* Step 1: Select Room & People */}
      {step === 1 && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2">
            <div className="card">
              <h2 className="font-display text-lg font-semibold text-white mb-6">Start New Count</h2>
              
              {/* Stream Room */}
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Stream Room *
                </label>
                <select
                  name="location_id"
                  value={form.location_id}
                  onChange={handleFormChange}
                  required
                >
                  <option value="">Select stream room...</option>
                  {locations.map(loc => (
                    <option key={loc.id} value={loc.id}>{loc.name}</option>
                  ))}
                </select>
              </div>
              
              {/* Streamer (sales attributed to) */}
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Streamer (sales go to) *
                </label>
                <select
                  name="streamer_id"
                  value={showNewStreamer ? 'other' : form.streamer_id}
                  onChange={handleFormChange}
                  required
                >
                  <option value="">Select streamer...</option>
                  {users.map(user => (
                    <option key={user.id} value={user.id}>{user.name}</option>
                  ))}
                  <option value="other">+ Add New Streamer</option>
                </select>
                
                {showNewStreamer && (
                  <input
                    type="text"
                    value={newStreamerName}
                    onChange={(e) => setNewStreamerName(e.target.value)}
                    placeholder="Enter new streamer name..."
                    className="mt-2"
                    autoFocus
                  />
                )}
              </div>
              
              {/* Counted By */}
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Counted By *
                </label>
                <select
                  name="counted_by_id"
                  value={showNewCounter ? 'other' : form.counted_by_id}
                  onChange={handleFormChange}
                  required
                >
                  <option value="">Who is counting...</option>
                  {users.map(user => (
                    <option key={user.id} value={user.id}>{user.name}</option>
                  ))}
                  <option value="other">+ Add New Person</option>
                </select>
                
                {showNewCounter && (
                  <input
                    type="text"
                    value={newCounterName}
                    onChange={(e) => setNewCounterName(e.target.value)}
                    placeholder="Enter name..."
                    className="mt-2"
                    autoFocus
                  />
                )}
              </div>
              
              {/* Date & Time */}
              <div className="grid grid-cols-2 gap-4 mb-6">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Date *
                  </label>
                  <input
                    type="date"
                    name="count_date"
                    value={form.count_date}
                    onChange={handleFormChange}
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Time *
                  </label>
                  <input
                    type="time"
                    name="count_time"
                    value={form.count_time}
                    onChange={handleFormChange}
                    required
                  />
                </div>
              </div>
              
              <button 
                onClick={handleStartCount}
                className="btn btn-primary w-full"
              >
                <Play size={20} />
                Start Count
              </button>
            </div>
          </div>
          
          {/* Recent Counts Sidebar */}
          <div>
            <div className="card">
              <button 
                onClick={() => setShowHistory(!showHistory)}
                className="w-full flex items-center justify-between text-left"
              >
                <h3 className="font-display text-lg font-semibold text-white flex items-center gap-2">
                  <History size={20} className="text-gray-400" />
                  Recent Counts
                </h3>
                {showHistory ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
              </button>
              
              {showHistory && (
                <div className="mt-4 space-y-3">
                  {recentCounts.length === 0 ? (
                    <p className="text-gray-500 text-sm">No counts yet</p>
                  ) : (
                    recentCounts.map(count => (
                      <div 
                        key={count.id} 
                        className="p-3 bg-vault-dark rounded-lg border border-vault-border cursor-pointer hover:border-vault-gold/30 transition-colors"
                        onClick={() => toggleReportExpand(count.id)}
                      >
                        <div className="flex justify-between items-start">
                          <div>
                            <p className="text-sm font-medium text-white">
                              {count.location?.name?.replace('Stream Room - ', '')}
                            </p>
                            <p className="text-xs text-gray-400">
                              {count.streamer?.name} • {new Date(count.count_time).toLocaleDateString()}
                            </p>
                          </div>
                          <div className="text-right">
                            <p className="text-sm font-medium text-vault-gold">
                              {count.total_sold} sold
                            </p>
                            {count.total_discrepancies > 0 && (
                              <p className="text-xs text-amber-400">
                                +{count.total_discrepancies} discrepancy
                              </p>
                            )}
                          </div>
                        </div>
                        
                        {expandedReport === count.id && (
                          <div className="mt-3 pt-3 border-t border-vault-border">
                            <p className="text-xs text-gray-400 mb-2">
                              Counted by: {count.counted_by?.name}
                            </p>
                            {expandedReportItems.filter(i => i.difference !== 0).length === 0 ? (
                              <p className="text-xs text-gray-500">No changes recorded</p>
                            ) : (
                              <div className="space-y-1">
                                {expandedReportItems
                                  .filter(i => i.difference !== 0)
                                  .map(item => (
                                    <div key={item.id} className="flex justify-between text-xs">
                                      <span className="text-gray-300 truncate mr-2">
                                        {item.product?.name}
                                      </span>
                                      <span className={item.difference < 0 ? 'text-green-400' : 'text-amber-400'}>
                                        {item.difference < 0 ? `${Math.abs(item.difference)} sold` : `+${item.difference}`}
                                      </span>
                                    </div>
                                  ))}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Step 2: Count Sheet */}
      {step === 2 && (
        <div className="card">
          <div className="mb-6 flex justify-between items-center">
            <div>
              <h2 className="font-display text-lg font-semibold text-white">
                {locations.find(l => l.id === form.location_id)?.name}
              </h2>
              <p className="text-sm text-gray-400">
                Streamer: {users.find(u => u.id === form.streamer_id)?.name} • 
                Counting: {users.find(u => u.id === form.counted_by_id)?.name} • 
                {form.count_date} @ {form.count_time}
              </p>
            </div>
            <div className="text-right">
              <p className="text-sm text-gray-400">{inventory.length} products</p>
            </div>
          </div>
          
          {inventory.length === 0 ? (
            <div className="text-center py-12">
              <Package className="mx-auto text-gray-600 mb-4" size={48} />
              <p className="text-gray-400">No inventory in this room</p>
              <button onClick={handleNewCount} className="btn btn-secondary mt-4">
                Select Different Room
              </button>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table>
                  <thead>
                    <tr>
                      <th>Launch Name</th>
                      <th>Brand</th>
                      <th>Product Type</th>
                      <th>Lang</th>
                      <th className="text-right">Expected</th>
                      <th className="text-right w-32">Actual Count</th>
                      <th className="text-right">Diff</th>
                    </tr>
                  </thead>
                  <tbody>
                    {inventory.map(inv => {
                      const expected = inv.quantity
                      const actual = counts[inv.product_id] ?? expected
                      const diff = (actual === '' ? 0 : actual) - expected
                      const launchName = extractLaunchName(inv.product?.name, inv.product?.category)
                      
                      return (
                        <tr key={inv.id} className={diff !== 0 ? 'bg-vault-gold/5' : ''}>
                          <td className="font-medium text-white">{launchName}</td>
                          <td>
                            <span className={`badge ${inv.product?.brand === 'Pokemon' ? 'badge-warning' : 'badge-info'}`}>
                              {inv.product?.brand}
                            </span>
                          </td>
                          <td className="text-gray-400">{inv.product?.category}</td>
                          <td className="text-gray-400">{inv.product?.language}</td>
                          <td className="text-right text-gray-400">{expected}</td>
                          <td className="text-right">
                            <input
                              type="number"
                              min="0"
                              value={counts[inv.product_id] ?? ''}
                              onChange={(e) => handleCountChange(inv.product_id, e.target.value)}
                              placeholder={expected.toString()}
                              className="w-24 text-right"
                            />
                          </td>
                          <td className="text-right">
                            {diff !== 0 && (
                              <span className={`font-medium ${diff < 0 ? 'text-green-400' : 'text-amber-400'}`}>
                                {diff > 0 ? '+' : ''}{diff}
                              </span>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              
              {/* Summary */}
              <div className="mt-6 pt-6 border-t border-vault-border">
                <div className="flex justify-between items-center">
                  <div className="flex gap-6">
                    <div>
                      <p className="text-sm text-gray-400">Items Sold</p>
                      <p className="font-display text-xl font-bold text-green-400">
                        {inventory.reduce((sum, inv) => {
                          const diff = (counts[inv.product_id] ?? inv.quantity) - inv.quantity
                          return sum + (diff < 0 ? Math.abs(diff) : 0)
                        }, 0)}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm text-gray-400">Discrepancies</p>
                      <p className="font-display text-xl font-bold text-amber-400">
                        {inventory.reduce((sum, inv) => {
                          const diff = (counts[inv.product_id] ?? inv.quantity) - inv.quantity
                          return sum + (diff > 0 ? diff : 0)
                        }, 0)}
                      </p>
                    </div>
                  </div>
                  
                  <button 
                    onClick={handleSubmitCount}
                    className="btn btn-primary"
                    disabled={submitting}
                  >
                    {submitting ? (
                      <div className="spinner w-5 h-5 border-2"></div>
                    ) : (
                      <>
                        <Save size={20} />
                        Submit Count
                      </>
                    )}
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* Step 3: Report */}
      {step === 3 && report && (
        <div className="max-w-2xl mx-auto">
          <div className="card">
            <div className="text-center mb-6">
              {report.status === 'complete' ? (
                <CheckCircle className="mx-auto text-green-400 mb-3" size={48} />
              ) : (
                <AlertTriangle className="mx-auto text-amber-400 mb-3" size={48} />
              )}
              <h2 className="font-display text-xl font-bold text-white">
                Count Submitted
              </h2>
            </div>
            
            {/* Report Header */}
            <div className="bg-vault-dark rounded-lg p-4 mb-6">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-gray-400">Stream Room</p>
                  <p className="text-white font-medium">{report.location}</p>
                </div>
                <div>
                  <p className="text-gray-400">Streamer</p>
                  <p className="text-white font-medium">{report.streamer}</p>
                </div>
                <div>
                  <p className="text-gray-400">Counted By</p>
                  <p className="text-white font-medium">{report.counted_by}</p>
                </div>
                <div>
                  <p className="text-gray-400">Time</p>
                  <p className="text-white font-medium">
                    {report.count_time.toLocaleDateString()} @ {report.count_time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>
              </div>
            </div>
            
            {/* Items Sold */}
            {report.sold_items.length > 0 && (
              <div className="mb-6">
                <h3 className="font-display text-lg font-semibold text-white mb-3 flex items-center gap-2">
                  <CheckCircle size={20} className="text-green-400" />
                  Items Sold ({report.total_sold} total)
                </h3>
                <div className="bg-green-400/10 rounded-lg border border-green-400/30 overflow-hidden">
                  <table>
                    <thead>
                      <tr className="border-b border-green-400/30">
                        <th className="text-green-400">Product</th>
                        <th className="text-right text-green-400">Was</th>
                        <th className="text-right text-green-400">Now</th>
                        <th className="text-right text-green-400">Sold</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.sold_items.map((item, idx) => (
                        <tr key={idx} className="border-b border-green-400/10 last:border-0">
                          <td className="text-white">{item.product?.name}</td>
                          <td className="text-right text-gray-400">{item.expected}</td>
                          <td className="text-right text-gray-400">{item.actual}</td>
                          <td className="text-right text-green-400 font-medium">{item.sold}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            
            {/* Discrepancies */}
            {report.discrepancy_items.length > 0 && (
              <div className="mb-6">
                <h3 className="font-display text-lg font-semibold text-white mb-3 flex items-center gap-2">
                  <AlertTriangle size={20} className="text-amber-400" />
                  Discrepancies (needs review)
                </h3>
                <div className="bg-amber-400/10 rounded-lg border border-amber-400/30 overflow-hidden">
                  <table>
                    <thead>
                      <tr className="border-b border-amber-400/30">
                        <th className="text-amber-400">Product</th>
                        <th className="text-right text-amber-400">Expected</th>
                        <th className="text-right text-amber-400">Counted</th>
                        <th className="text-right text-amber-400">Extra</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.discrepancy_items.map((item, idx) => (
                        <tr key={idx} className="border-b border-amber-400/10 last:border-0">
                          <td className="text-white">{item.product?.name}</td>
                          <td className="text-right text-gray-400">{item.expected}</td>
                          <td className="text-right text-gray-400">{item.actual}</td>
                          <td className="text-right text-amber-400 font-medium">+{item.extra}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="text-xs text-amber-400/70 mt-2">
                  ⚠️ Possible unlogged inbound movement
                </p>
              </div>
            )}
            
            {/* No Changes */}
            {report.sold_items.length === 0 && report.discrepancy_items.length === 0 && (
              <div className="text-center py-6">
                <p className="text-gray-400">No changes from expected inventory</p>
              </div>
            )}
            
            {/* Actions */}
            <div className="mt-6 pt-6 border-t border-vault-border">
              <button onClick={handleNewCount} className="btn btn-primary w-full">
                <ClipboardList size={20} />
                Start New Count
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
