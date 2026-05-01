import React, { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { ToastContainer, useToast } from '../components/Toast'
import Instructions from '../components/Instructions'
import { Users, Plus, Edit2, Trash2, Save, X, UserPlus, Key, RefreshCw, Check } from 'lucide-react'

// All available pages with labels
const ALL_PAGES = [
  { path: '/', label: 'Dashboard' },
  { path: '/inventory', label: 'View Inventory' },
  { path: '/move-inventory', label: 'Move Inventory' },
  { path: '/online-orders', label: 'Online Orders' },
  { path: '/manual-inventory', label: 'Manual Inventory' },
  { path: '/stream-counts', label: 'Stream Counts' },
  { path: '/platform-sales', label: 'Platform Sales' },
  { path: '/add-product', label: 'Add Product' },
  { path: '/purchased-items', label: 'Purchased Items' },
  { path: '/intake', label: 'Intake to Master' },
  { path: '/break-box', label: 'Break Box' },
  { path: '/expenses', label: 'Business Expenses' },
  { path: '/reports', label: 'Reports' },
  { path: '/users', label: 'Team Management' },
  { path: '/high-value', label: 'High Value (Separate)' },
]

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
      allowed_pages: user.allowed_pages || ['/']
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
          allowed_pages: editingUser.allowed_pages
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
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 p-3 bg-vault-dark rounded-lg max-h-48 overflow-y-auto">
                {ALL_PAGES.map(page => (
                  <label key={page.path} className="flex items-center gap-2 cursor-pointer hover:bg-vault-surface p-1 rounded">
                    <input
                      type="checkbox"
                      checked={newUser.allowed_pages.includes(page.path)}
                      onChange={() => toggleNewUserPage(page.path)}
                      className="w-4 h-4 rounded border-vault-border bg-vault-surface text-vault-gold focus:ring-vault-gold"
                    />
                    <span className="text-sm text-gray-300">{page.label}</span>
                  </label>
                ))}
              </div>
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
                
                <div className="grid grid-cols-2 gap-2 p-3 bg-vault-dark rounded-lg max-h-64 overflow-y-auto">
                  {ALL_PAGES.map(page => (
                    <label 
                      key={page.path} 
                      className={`flex items-center gap-2 cursor-pointer p-2 rounded transition-all ${
                        editingUser.allowed_pages?.includes(page.path) 
                          ? 'bg-vault-gold/10 border border-vault-gold/30' 
                          : 'hover:bg-vault-surface'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={editingUser.allowed_pages?.includes(page.path) || false}
                        onChange={() => togglePageAccess(page.path)}
                          className="w-4 h-4 rounded border-vault-border bg-vault-surface text-vault-gold focus:ring-vault-gold"
                        />
                        <span className={`text-sm ${
                          editingUser.allowed_pages?.includes(page.path) ? 'text-white' : 'text-gray-400'
                        }`}>
                          {page.label}
                        </span>
                      </label>
                    ))}
                  </div>
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
