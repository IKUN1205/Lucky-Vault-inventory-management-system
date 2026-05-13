import React, { createContext, useContext, useState, useEffect } from 'react'
import { supabase } from './supabase'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Check for existing session in localStorage
    const savedUser = localStorage.getItem('luckyvault_user')
    if (savedUser) {
      try {
        const parsed = JSON.parse(savedUser)
        // Verify user still exists and is active
        verifyUser(parsed.id)
      } catch (e) {
        localStorage.removeItem('luckyvault_user')
        setLoading(false)
      }
    } else {
      setLoading(false)
    }
  }, [])

  // Both verifyUser (session restore) and login (fresh PIN entry) honour
  // both `active` and `can_login`. The users schema has both — `active`
  // marks a kept-but-frozen account, `can_login` is the more granular
  // "can this person use the app right now" toggle. Previously only
  // `active` was checked, so a user with `can_login=false` could still
  // sign in, defeating the purpose of the column.
  //
  // can_login is checked in JS after the fetch (rather than as a filter)
  // so legacy rows where the column is NULL are treated as "allowed" —
  // only an explicit `false` blocks access.
  const verifyUser = async (userId) => {
    try {
      const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('id', userId)
        .eq('active', true)
        .single()

      if (data && !error && data.can_login !== false) {
        setUser(data)
        localStorage.setItem('luckyvault_user', JSON.stringify(data))
      } else {
        localStorage.removeItem('luckyvault_user')
      }
    } catch (e) {
      localStorage.removeItem('luckyvault_user')
    } finally {
      setLoading(false)
    }
  }

  // Login supports shared PINs: multiple users can have the same 4-digit
  // PIN (e.g. all streamers using 1234). Behaviour by match count:
  //   0 candidates → "Invalid PIN"
  //   1 candidate  → log them in directly (the simple case)
  //   2+ candidates → return { needsPicker, candidates } so the Login
  //                   page can show "who are you?" and call loginAs(id)
  // The previous implementation used .single(), which errored on 2+ matches
  // — that's why "all streamers share 1234" silently broke logins.
  const login = async (pin) => {
    try {
      const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('pin', pin)
        .eq('active', true)

      if (error) {
        return { success: false, error: 'Login failed' }
      }
      const candidates = (data || []).filter(u => u.can_login !== false)
      if (candidates.length === 0) {
        // Either no row matched, or every match has can_login=false
        const anyDisabled = (data || []).some(u => u.can_login === false)
        return {
          success: false,
          error: anyDisabled
            ? 'Account is disabled — contact your admin.'
            : 'Invalid PIN',
        }
      }
      if (candidates.length === 1) {
        const u = candidates[0]
        setUser(u)
        localStorage.setItem('luckyvault_user', JSON.stringify(u))
        return { success: true, user: u }
      }
      // 2+ matches — let the Login page show a picker. Pass back just
      // the minimum info needed for the picker (id + name + role).
      return {
        success: false,
        needsPicker: true,
        candidates: candidates.map(u => ({
          id: u.id,
          name: u.name,
          role: u.role,
        })),
      }
    } catch (e) {
      return { success: false, error: 'Login failed' }
    }
  }

  // Finalise login for a specific user id (used after the PIN picker
  // when 2+ users shared a PIN). We re-fetch the row to avoid trusting
  // anything from the client-side candidate list, and re-validate the
  // active / can_login gates.
  const loginAs = async (userId) => {
    try {
      const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('id', userId)
        .eq('active', true)
        .single()
      if (error || !data) {
        return { success: false, error: 'User not found' }
      }
      if (data.can_login === false) {
        return { success: false, error: 'Account is disabled — contact your admin.' }
      }
      setUser(data)
      localStorage.setItem('luckyvault_user', JSON.stringify(data))
      return { success: true, user: data }
    } catch (e) {
      return { success: false, error: 'Login failed' }
    }
  }

  const logout = () => {
    setUser(null)
    localStorage.removeItem('luckyvault_user')
  }

  const hasAccess = (path) => {
    if (!user) return false
    
    const allowedPages = user.allowed_pages || []
    // If user has access to /users (Team Management), they're effectively admin
    if (allowedPages.includes('/users')) return true
    
    return allowedPages.includes(path)
  }

  const isAdmin = () => {
    // Admin is anyone who has access to Team Management
    return user?.allowed_pages?.includes('/users')
  }

  // Accept the PIN if ANY active, non-disabled user with that PIN has
  // admin access (i.e. /users in allowed_pages). Doesn't use .single()
  // because PINs can be shared across users.
  const verifyAdminPin = async (pin) => {
    try {
      const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('pin', pin)
        .eq('active', true)
      if (error) return false
      return (data || []).some(
        u => u.can_login !== false && u.allowed_pages?.includes('/users')
      )
    } catch (e) {
      return false
    }
  }

  // Refresh user data (after permissions change)
  const refreshUser = async () => {
    if (user?.id) {
      await verifyUser(user.id)
    }
  }

  return (
    <AuthContext.Provider value={{
      user,
      loading,
      login,
      loginAs,
      logout,
      hasAccess,
      isAdmin,
      verifyAdminPin,
      refreshUser
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider')
  }
  return context
}
