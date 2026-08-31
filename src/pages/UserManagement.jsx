import React, { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { FEATURE_FLAGS } from '../lib/featureFlags'
import { ToastContainer, useToast } from '../components/Toast'
import Instructions from '../components/Instructions'
import { Users, Plus, Edit2, Trash2, Save, X, UserPlus, Key, RefreshCw, Check } from 'lucide-react'

// All available pages with labels, grouped by sidebar section. Keep in sync
// with the routes declared in src/App.jsx and the sidebar items in
// src/components/Layout.jsx — every route the user might want to grant
// access to should appear here so admins can actually toggle it from Team
// Management.
//
// Section ordering matches the sidebar (Overview → Receive → Operations →
// Sales → Reports → Cards → Japan → Admin) so the picker reads top-to-bottom
// the same way the sidebar does. Pages that aren't in the sidebar (legacy or
// deep-link only) live in a final "Legacy / Deep-link" section, which is
// `collapsible: true` so it doesn't bulk up the picker by default.
const PAGE_SECTIONS = [
  // Manual Inventory in Overview (not Receive) — it's a quick stock-adjust
  // tool, not a vendor-receive step. Add Product in Operations (not
  // Receive) — creating a SKU is a catalog action, not a receive action.
  // Keep this grouping in lock-step with navSections in Layout.jsx so the
  // permission picker reads the same way as what the user sees in the
  // sidebar.
  { title: 'Overview', items: [
    { path: '/', label: 'Dashboard' },
    { path: '/inventory', label: 'View Inventory' },
    { path: '/manual-inventory', label: 'Manual Inventory' },
  ]},
  { title: 'Receive', items: [
    { path: '/purchased-items', label: 'Purchased Items' },
    { path: '/buy-list', label: 'Buy List Intake' },
    { path: '/intake', label: 'Intake to Master' },
    { path: '/storefront-import', label: 'Storefront Import' },
  ]},
  { title: 'Operations', items: [
    { path: '/move-inventory', label: 'Move Inventory' },
    { path: '/break-box', label: 'Break Box' },
    { path: '/add-product', label: 'Add Product' },
    { path: '/product-barcodes', label: 'Product Barcodes' },
  ]},
  { title: 'Sales', items: [
    { path: '/stream-counts', label: 'Stream Counts' },
    { path: '/stream-sessions', label: 'Stream Session History' },
    { path: '/platform-sales', label: 'Platform Sales' },
    { path: '/online-orders', label: 'Online Orders' },
    { path: '/storefront-sale', label: 'Storefront Sales' },
    { path: '/returns', label: 'Returns' },
  ]},
  { title: 'Reports', items: [
    { path: '/reports', label: 'Reports' },
    { path: '/weekly-usage', label: 'Weekly Usage' },
    { path: '/turnover', label: 'Turnover' },
    { path: '/executive-report', label: 'Executive Report' },
    { path: '/audit-history', label: 'Audit History' },
  ]},
  // Cards = unified Singles + Slabs section (sidebar entries)
  { title: 'Cards', items: [
    { path: '/cards', label: 'Cards Inventory' },
    { path: '/cards/scan', label: 'Cards Scan' },
    { path: '/cards/log', label: 'Cards Activity Log' },
    { path: '/cards/audit', label: 'Cards Sheet Audit' },
  ]},
  // Japan 🇯🇵 — lightweight branch, shared DB.
  // See scripts/add_japan_inventory_system.sql.
  { title: 'Japan 🇯🇵', items: [
    { path: '/jp/inventory', label: '日本库存 / Japan Inventory' },
    { path: '/jp/acquisitions', label: '日本进货 / Japan Acquisitions' },
    { path: '/jp/stream-sales', label: '日本直播售卖 / Japan Stream Sales' },
    { path: '/jp/local-sales', label: '日本当地售卖 / Japan Local Sales' },
    { path: '/jp/shipments', label: '日本→美国发货 / Japan→US Shipment' },
    { path: '/jp/log', label: '日本日志 / Japan Activity Log' },
    { path: '/jp/add-product', label: '日本新增 SKU / Japan Add Product' },
  ]},
  // China finance branch — flag-gated (VITE_ENABLE_CN_JP_FINANCE).
  // See sql/cn_jp_finance.sql. Hidden from the picker when the flag is off.
  ...(FEATURE_FLAGS.cnJpFinance ? [{ title: 'China 🇨🇳', items: [
    { path: '/cn/acquisitions', label: '中国进货 / China Acquisitions' },
    { path: '/cn/fx-transfers', label: '外汇划转 / FX Transfers (CNY→USD)' },
  ]}] : []),
  { title: 'Admin', items: [
    { path: '/high-value', label: 'High Value' },
    { path: '/expenses', label: 'Business Expenses' },
    { path: '/audit', label: 'Sales Audit' },
    { path: '/product-mapping', label: 'Product Mapping' },
    { path: '/users', label: 'Team Management' },
  ]},
  // Legacy / deep-link only — kept so admins can grant access for users
  // who hit these URLs directly. /singles + /slabs are pre-unification
  // routes that still resolve. /grading is reachable from older flows.
  // Collapsed by default because most admins shouldn't need to touch these.
  { title: 'Legacy / Deep-link', collapsible: true, defaultCollapsed: true, items: [
    { path: '/grading', label: 'Send to Grading (legacy)' },
    { path: '/singles', label: 'Singles Inventory (legacy)' },
    { path: '/singles/scan', label: 'Singles Scan (legacy)' },
    { path: '/singles/log', label: 'Singles Activity Log (legacy)' },
    { path: '/singles/add', label: 'Add Single (deep-link)' },
    { path: '/singles/bulk-add', label: 'Bulk Add Singles (deep-link)' },
    { path: '/slabs', label: 'Slabs Inventory (legacy)' },
  ]},
]

// Flat list of all pages — kept as a derived export so the rest of the file
// (Select All, page-count badges, lookup by path) doesn't have to know about
// the section structure.
const ALL_PAGES = PAGE_SECTIONS.flatMap(s => s.items)

export default function UserManagement() {
  const { toasts, addToast, removeToast } = useToast()
  const { user: currentUser, refreshUser } = useAuth()
  
  const [users, setUsers] = useState([])
  const [locations, setLocations] = useState([])
  const [userRooms, setUserRooms] = useState([])
  const [loading, setLoading] = useState(true)
  
  const [showAddForm, setShowAddForm] = useState(false)
  const [editingUser, setEditingUser] = useState(null) // Full edit modal
  
  const [newUser, setNewUser] = useState({
    name: '',
    role: 'Streamer',
    pin: '',
    rooms: [],
    allowed_pages: ['/'] // Default to dashboard only
  })
  const [submitting, setSubmitting] = useState(false)

  // Track which Page Access sections are collapsed in the picker. Seeded
  // from each section's `defaultCollapsed` flag — only Legacy starts folded.
  // Set-of-titles so toggling one section doesn't re-render the others.
  const [collapsedSections, setCollapsedSections] = useState(
    () => new Set(PAGE_SECTIONS.filter(s => s.defaultCollapsed).map(s => s.title))
  )
  const toggleSectionCollapsed = (title) => {
    setCollapsedSections(prev => {
      const next = new Set(prev)
      if (next.has(title)) next.delete(title); else next.add(title)
      return next
    })
  }

  useEffect(() => {
    loadData()
  }, [])

  const loadData = async () => {
    try {
      const [usersRes, locationsRes, roomsRes] = await Promise.all([
        supabase
          .from('users')
          .select('*')
          .order('name'),
        supabase
          .from('locations')
          .select('*')
          .eq('active', true)
          .ilike('name', '%Stream Room%')
          .order('name'),
        supabase
          .from('user_rooms')
          .select('*, location:locations(name)')
      ])
      
      setUsers(usersRes.data || [])
      setLocations(locationsRes.data || [])
      setUserRooms(roomsRes.data || [])
    } catch (error) {
      console.error('Error loading data:', error)
      addToast('Failed to load data', 'error')
    } finally {
      setLoading(false)
    }
  }

  const getUserRooms = (userId) => {
    return userRooms.filter(ur => ur.user_id === userId)
  }

  // Generate random 4-digit PIN
  const generatePin = () => {
    return Math.floor(1000 + Math.random() * 9000).toString()
  }

  // Check if PIN is unique
  const isPinUnique = (pin, excludeUserId = null) => {
    return !users.some(u => u.pin === pin && u.id !== excludeUserId && u.active)
  }

  const handleAddUser = async (e) => {
    e.preventDefault()
    
    if (!newUser.name.trim()) {
      addToast('Please enter a name', 'error')
      return
    }

    // Generate PIN if not set
    let pin = newUser.pin
    if (!pin) {
      pin = generatePin()
      // Make sure it's unique
      while (!isPinUnique(pin)) {
        pin = generatePin()
      }
    } else if (!isPinUnique(pin)) {
      addToast('This PIN is already in use', 'error')
      return
    }

    setSubmitting(true)
    try {
      // Create user
      const { data: userData, error: userError } = await supabase
        .from('users')
        .insert({
          name: newUser.name.trim(),
          pin: pin,
          active: true,
          can_login: true,
          allowed_pages: newUser.allowed_pages
        })
        .select()
        .single()

      if (userError) throw userError

      // Add room assignments
      if (newUser.rooms.length > 0) {
        const roomAssignments = newUser.rooms.map(locId => ({
          user_id: userData.id,
          location_id: locId
        }))
        
        await supabase.from('user_rooms').insert(roomAssignments)
      }

      addToast(`User added! PIN: ${pin}`)
      setNewUser({ name: '', role: 'Streamer', pin: '', rooms: [], allowed_pages: ['/'] })
      setShowAddForm(false)
      loadData()
    } catch (error) {
      console.error('Error adding user:', error)
      if (error.message?.includes('duplicate')) {
        addToast('A user with this name or PIN already exists', 'error')
      } else {
        addToast('Failed to add user', 'error')
      }
    } finally {
      setSubmitting(false)
    }
  }

  const openEditModal = (user) => {
    setEditingUser({
      ...user,
      allowed_pages: user.allowed_pages || ['/'],
      // Existing rows without can_login (NULL) are treated as enabled
      // for backwards-compat; only an explicit false disables.
      can_login: user.can_login !== false,
    })
  }

  const closeEditModal = () => {
    setEditingUser(null)
  }

  const saveUserEdit = async () => {
    if (!editingUser) return
    
    if (!editingUser.name.trim()) {
      addToast('Name cannot be empty', 'error')
      return
    }

    if (editingUser.pin && !isPinUnique(editingUser.pin, editingUser.id)) {
      addToast('This PIN is already in use', 'error')
      return
    }

    setSubmitting(true)
    try {
      const { error } = await supabase
        .from('users')
        .update({
          name: editingUser.name.trim(),
          pin: editingUser.pin,
          allowed_pages: editingUser.allowed_pages,
          // Default to true on save so the toggle's "on by default" state
          // sticks even on rows that pre-date the can_login column. The
          // UI ensures editingUser.can_login is always set explicitly
          // when the modal opens.
          can_login: editingUser.can_login !== false,
        })
        .eq('id', editingUser.id)

      if (error) throw error

      addToast('User updated!')
      
      // If editing current user, refresh their data
      if (editingUser.id === currentUser?.id) {
        refreshUser()
      }
      
      closeEditModal()
      loadData()
    } catch (error) {
      console.error('Error updating user:', error)
      addToast('Failed to update user', 'error')
    } finally {
      setSubmitting(false)
    }
  }

  const resetUserPin = async (userId) => {
    const newPin = generatePin()
    // Make sure it's unique
    let pin = newPin
    while (!isPinUnique(pin, userId)) {
      pin = generatePin()
    }

    try {
      const { error } = await supabase
        .from('users')
        .update({ pin })
        .eq('id', userId)

      if (error) throw error

      addToast(`PIN reset to: ${pin}`)
      loadData()
    } catch (error) {
      console.error('Error resetting PIN:', error)
      addToast('Failed to reset PIN', 'error')
    }
  }

  const toggleUserActive = async (user) => {
    try {
      const { error } = await supabase
        .from('users')
        .update({ active: !user.active })
        .eq('id', user.id)

      if (error) throw error

      addToast(user.active ? 'User deactivated' : 'User activated')
      loadData()
    } catch (error) {
      console.error('Error toggling user:', error)
      addToast('Failed to update user', 'error')
    }
  }

  const togglePageAccess = (pagePath) => {
    if (!editingUser) return
    
    const currentPages = editingUser.allowed_pages || []
    const newPages = currentPages.includes(pagePath)
      ? currentPages.filter(p => p !== pagePath)
      : [...currentPages, pagePath]
    
    setEditingUser({ ...editingUser, allowed_pages: newPages })
  }

  const selectAllPages = () => {
    if (!editingUser) return
    setEditingUser({ ...editingUser, allowed_pages: ALL_PAGES.map(p => p.path) })
  }

  const clearAllPages = () => {
    if (!editingUser) return
    setEditingUser({ ...editingUser, allowed_pages: ['/'] }) // Keep dashboard at minimum
  }

  const toggleNewUserPage = (pagePath) => {
    const currentPages = newUser.allowed_pages || []
    const newPages = currentPages.includes(pagePath)
      ? currentPages.filter(p => p !== pagePath)
      : [...currentPages, pagePath]

    setNewUser({ ...newUser, allowed_pages: newPages })
  }

  // Section-level toggle: bulk-add or bulk-remove every page in one section.
  // Dashboard ('/') is always kept selected — without it the user lands on
  // Access Denied right after login with no escape, so it functions as a
  // minimum-floor permission.
  const applySectionToggle = (currentPages, sectionItems, makeSelected) => {
    const next = new Set(currentPages || [])
    const paths = sectionItems.map(i => i.path)
    if (makeSelected) {
      paths.forEach(p => next.add(p))
    } else {
      paths.forEach(p => next.delete(p))
    }
    next.add('/')  // floor
    return Array.from(next)
  }
  const toggleEditingSection = (sectionItems, makeSelected) => {
    if (!editingUser) return
    setEditingUser({
      ...editingUser,
      allowed_pages: applySectionToggle(editingUser.allowed_pages, sectionItems, makeSelected),
    })
  }
  const toggleNewUserSection = (sectionItems, makeSelected) => {
    setNewUser({
      ...newUser,
      allowed_pages: applySectionToggle(newUser.allowed_pages, sectionItems, makeSelected),
    })
  }

  // Shared renderer for both the Add User form and the Edit User modal.
  // Both forms have identical visual treatment — only the selected set and
  // the onToggle callbacks differ — so we route them through one function
  // to avoid drift between the two pickers as we iterate on UX.
  const renderPageAccessPicker = ({ selected, onTogglePage, onToggleSection }) => {
    const selectedSet = new Set(selected || [])
    return (
      <div className="space-y-3 p-3 bg-vault-dark rounded-lg max-h-96 overflow-y-auto">
        {PAGE_SECTIONS.map(section => {
          const isCollapsed = collapsedSections.has(section.title)
          const checkedCount = section.items.filter(i => selectedSet.has(i.path)).length
          const allChecked = checkedCount === section.items.length
          return (
            <div key={section.title} className="space-y-1">
              <div className="flex items-center justify-between px-1">
                <button
                  type="button"
                  onClick={() => section.collapsible && toggleSectionCollapsed(section.title)}
                  className={`flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-gray-500 ${section.collapsible ? 'hover:text-gray-300' : 'cursor-default'}`}
                >
                  {section.collapsible && (
                    <span className="text-gray-600">{isCollapsed ? '▸' : '▾'}</span>
                  )}
                  <span>{section.title}</span>
                  {section.collapsible && (
                    <span className="text-gray-600 normal-case font-normal">({section.items.length})</span>
                  )}
                  {checkedCount > 0 && (
                    <span className="text-vault-gold normal-case font-normal">· {checkedCount}/{section.items.length} selected</span>
                  )}
                </button>
                {!isCollapsed && (
                  <button
                    type="button"
                    onClick={() => onToggleSection(section.items, !allChecked)}
                    className="text-[10px] text-blue-400 hover:text-blue-300"
                  >
                    {allChecked ? 'Clear section' : 'Select section'}
                  </button>
                )}
              </div>
              {!isCollapsed && (
                <div className="grid grid-cols-2 gap-1.5">
                  {section.items.map(page => (
                    <label
                      key={page.path}
                      className={`flex items-center gap-2 cursor-pointer p-1.5 rounded transition-all ${
                        selectedSet.has(page.path)
                          ? 'bg-vault-gold/10 border border-vault-gold/30'
                          : 'hover:bg-vault-surface border border-transparent'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={selectedSet.has(page.path)}
                        onChange={() => onTogglePage(page.path)}
                        className="w-4 h-4 rounded border-vault-border bg-vault-surface text-vault-gold focus:ring-vault-gold"
                      />
                      <span className={`text-sm ${selectedSet.has(page.path) ? 'text-white' : 'text-gray-400'}`}>
                        {page.label}
                      </span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
    )
  }

  const activeUsers = users.filter(u => u.active)
  const inactiveUsers = users.filter(u => !u.active)

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
      
      <div className="mb-6 flex justify-between items-start">
        <div>
          <h1 className="font-display text-2xl font-bold text-white flex items-center gap-3">
            <Users className="text-blue-400" />
            Team Management
          </h1>
          <p className="text-gray-400 mt-1">Manage users, PINs, and access permissions</p>
        </div>
        <button
          onClick={() => setShowAddForm(true)}
          className="btn btn-primary"
        >
          <UserPlus size={18} /> Add User
        </button>
      </div>

      <Instructions>
        <div className="space-y-3 text-gray-300">
          <p className="font-medium text-white">Manage team access:</p>
          <ul className="list-disc list-inside space-y-2 ml-2">
            <li><span className="text-vault-gold">Add User</span> - Create new team members with PIN login</li>
            <li><span className="text-vault-gold">Edit</span> - Change name, PIN, or page access</li>
            <li><span className="text-vault-gold">Reset PIN</span> - Generate a new 4-digit PIN</li>
            <li><span className="text-vault-gold">Deactivate</span> - Disable access without deleting</li>
          </ul>
          <p className="text-blue-400 text-xs mt-3">💡 Control which pages each user can access by checking/unchecking pages</p>
        </div>
      </Instructions>

      {/* Add New User Form */}
      {showAddForm && (
        <div className="card mb-6 border-blue-500/30">
          <h2 className="font-display text-lg font-semibold text-white mb-4">Add New User</h2>
          
          <form onSubmit={handleAddUser} className="space-y-4">
            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">Name *</label>
                <input
                  type="text"
                  value={newUser.name}
                  onChange={(e) => setNewUser(u => ({ ...u, name: e.target.value }))}
                  placeholder="e.g., Michelle"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">PIN (4 digits)</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newUser.pin}
                    onChange={(e) => setNewUser(u => ({ ...u, pin: e.target.value.replace(/\D/g, '').slice(0, 4) }))}
                    placeholder="Auto-generate"
                    maxLength={4}
                    className="flex-1"
                  />
                  <button
                    type="button"
                    onClick={() => setNewUser(u => ({ ...u, pin: generatePin() }))}
                    className="btn btn-secondary px-3"
                    title="Generate random PIN"
                  >
                    <RefreshCw size={16} />
                  </button>
                </div>
              </div>
            </div>

            {/* Page Access */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">Page Access</label>
              {renderPageAccessPicker({
                selected: newUser.allowed_pages,
                onTogglePage: toggleNewUserPage,
                onToggleSection: toggleNewUserSection,
              })}
            </div>

            <div className="flex gap-2">
              <button type="submit" className="btn btn-primary" disabled={submitting}>
                {submitting ? <div className="spinner w-5 h-5 border-2"></div> : <><Plus size={18} /> Add User</>}
              </button>
              <button type="button" onClick={() => setShowAddForm(false)} className="btn btn-secondary">
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Active Users */}
      <div className="card mb-6">
        <h2 className="font-display text-lg font-semibold text-white mb-4">
          Active Users ({activeUsers.length})
        </h2>
        
        {activeUsers.length === 0 ? (
          <p className="text-gray-400 text-center py-8">No active users</p>
        ) : (
          <div className="overflow-x-auto">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>PIN</th>
                  <th>Page Access</th>
                  <th className="w-32">Actions</th>
                </tr>
              </thead>
              <tbody>
                {activeUsers.map(user => {
                  const pageCount = (user.allowed_pages || []).length
                  const hasFullAccess = user.allowed_pages?.includes('/users')
                  
                  return (
                    <tr key={user.id}>
                      <td className="font-medium text-white">{user.name}</td>
                      <td>
                        <div className="flex items-center gap-2">
                          <code className="bg-vault-dark px-2 py-1 rounded text-vault-gold">
                            {user.pin || '----'}
                          </code>
                          <button
                            onClick={() => resetUserPin(user.id)}
                            className="text-gray-500 hover:text-blue-400"
                            title="Reset PIN"
                          >
                            <RefreshCw size={14} />
                          </button>
                        </div>
                      </td>
                      <td>
                        <span className="text-gray-400 text-sm">
                          {hasFullAccess ? (
                            <span className="text-vault-gold">Full Access (Admin)</span>
                          ) : (
                            `${pageCount} page${pageCount !== 1 ? 's' : ''}`
                          )}
                        </span>
                      </td>
                      <td>
                        <div className="flex items-center gap-1">
                          <button 
                            onClick={() => openEditModal(user)} 
                            className="p-1 text-gray-500 hover:text-white" 
                            title="Edit"
                          >
                            <Edit2 size={16} />
                          </button>
                          {user.id !== currentUser?.id && (
                            <button 
                              onClick={() => toggleUserActive(user)} 
                              className="p-1 text-gray-500 hover:text-red-400" 
                              title="Deactivate"
                            >
                              <Trash2 size={16} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Inactive Users */}
      {inactiveUsers.length > 0 && (
        <div className="card opacity-75">
          <h2 className="font-display text-lg font-semibold text-gray-400 mb-4">
            Inactive ({inactiveUsers.length})
          </h2>
          
          <div className="overflow-x-auto">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Role</th>
                  <th className="w-32">Actions</th>
                </tr>
              </thead>
              <tbody>
                {inactiveUsers.map(user => (
                  <tr key={user.id} className="opacity-60">
                    <td className="text-gray-400">{user.name}</td>
                    <td className="text-gray-500">{user.role || 'Streamer'}</td>
                    <td>
                      <button 
                        onClick={() => toggleUserActive(user)} 
                        className="text-sm text-blue-400 hover:text-blue-300"
                      >
                        Reactivate
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Edit User Modal */}
      {editingUser && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-vault-surface border border-vault-border rounded-xl max-w-2xl w-full max-h-[90vh] overflow-hidden">
            <div className="p-4 border-b border-vault-border flex justify-between items-center">
              <h2 className="font-display text-lg font-semibold text-white">
                Edit User: {editingUser.name}
              </h2>
              <button onClick={closeEditModal} className="text-gray-400 hover:text-white">
                <X size={20} />
              </button>
            </div>
            
            <div className="p-4 space-y-4 overflow-y-auto max-h-[60vh]">
              {/* Basic Info */}
              <div className="grid md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">Name</label>
                  <input
                    type="text"
                    value={editingUser.name}
                    onChange={(e) => setEditingUser({ ...editingUser, name: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">PIN</label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={editingUser.pin || ''}
                      onChange={(e) => setEditingUser({ ...editingUser, pin: e.target.value.replace(/\D/g, '').slice(0, 4) })}
                      maxLength={4}
                      className="flex-1"
                    />
                    <button
                      type="button"
                      onClick={() => setEditingUser({ ...editingUser, pin: generatePin() })}
                      className="btn btn-secondary px-3"
                      title="Generate random PIN"
                    >
                      <RefreshCw size={16} />
                    </button>
                  </div>
                </div>
              </div>

              {/* Login enable toggle. People created inline from the
                  Stream Counts form (createUser) default to can_login=false
                  because most of those rows are just "who streamed" tags,
                  not login accounts. When they SHOULD be a login account
                  (like the shared "Streamer" PIN setup) this toggle is
                  the only UI to flip it on without going into SQL. */}
              <div className="flex items-center justify-between bg-vault-darker/40 border border-vault-border rounded-lg px-4 py-3">
                <div>
                  <div className="text-sm font-medium text-white">Allow login</div>
                  <div className="text-xs text-gray-500 mt-0.5">
                    If off, this person can't sign in with their PIN — even though they
                    still appear in dropdowns (e.g. "who streamed last").
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setEditingUser({ ...editingUser, can_login: !editingUser.can_login })}
                  role="switch"
                  aria-checked={editingUser.can_login}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                    editingUser.can_login ? 'bg-vault-gold' : 'bg-vault-border'
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                      editingUser.can_login ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>

              {/* Page Access */}
              <div>
                <div className="flex justify-between items-center mb-2">
                  <label className="block text-sm font-medium text-gray-300">Page Access</label>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={selectAllPages}
                      className="text-xs text-blue-400 hover:text-blue-300"
                    >
                      Select All
                    </button>
                    <button
                      type="button"
                      onClick={clearAllPages}
                      className="text-xs text-gray-400 hover:text-gray-300"
                    >
                      Clear All
                    </button>
                  </div>
                </div>

                {renderPageAccessPicker({
                  selected: editingUser.allowed_pages,
                  onTogglePage: togglePageAccess,
                  onToggleSection: toggleEditingSection,
                })}
              </div>
            </div>
            
            <div className="p-4 border-t border-vault-border flex justify-end gap-2">
              <button onClick={closeEditModal} className="btn btn-secondary">Cancel</button>
              <button 
                onClick={saveUserEdit} 
                className="btn btn-primary"
                disabled={submitting}
              >
                {submitting ? <div className="spinner w-4 h-4 border-2"></div> : <><Save size={18} /> Save Changes</>}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
