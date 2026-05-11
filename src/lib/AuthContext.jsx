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

  const login = async (pin) => {
    try {
      const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('pin', pin)
        .eq('active', true)
        .single()

      if (error || !data) {
        return { success: false, error: 'Invalid PIN' }
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

  const verifyAdminPin = async (pin) => {
    try {
      const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('pin', pin)
        .eq('active', true)
        .single()
      
      // Check if user has Team Management access (admin)
      if (!error && data && data.allowed_pages?.includes('/users')) {
        return true
      }
      return false
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
