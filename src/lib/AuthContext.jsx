import React, { createContext, useContext, useState, useEffect, useRef } from 'react'
import { getSessionToken, setSessionToken, postJson } from './apiSession'

const AuthContext = createContext(null)

// Sign-in is checked on the server (api/auth.js, D-20261021-04 step 1). The browser never reads the users table
// for PINs any more; it keeps a signed session token and a copy of its own user row (no PIN) for display.
const USER_KEY = 'luckyvault_user'

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  const picker = useRef(null)          // signed list of ids from a shared-PIN login, for loginAs()

  const signIn = (u, token) => {
    setSessionToken(token)
    setUser(u)
    localStorage.setItem(USER_KEY, JSON.stringify(u))
  }

  const signOut = () => {
    setSessionToken('')
    setUser(null)
    localStorage.removeItem(USER_KEY)
  }

  useEffect(() => {
    // A user saved by the old build (no session token) has to sign in once with the new flow.
    if (!getSessionToken()) {
      localStorage.removeItem(USER_KEY)
      setLoading(false)
      return
    }
    verifyUser()
  }, [])

  // Restore the session: the server re-reads the row (active / can_login / pages) and slides the expiry.
  // Only a definite "no" (401/403) signs out; a network blip keeps the saved row so the screen stays usable.
  const verifyUser = async () => {
    try {
      const { status, data } = await postJson('/api/auth?action=session')
      if (data?.ok && data.user) {
        signIn(data.user, data.token)
      } else if (status === 401 || status === 403) {
        signOut()
      } else {
        const saved = localStorage.getItem(USER_KEY)
        if (saved) setUser(JSON.parse(saved))
      }
    } catch (e) {
      try {
        const saved = localStorage.getItem(USER_KEY)
        if (saved) setUser(JSON.parse(saved))
      } catch { signOut() }
    } finally {
      setLoading(false)
    }
  }

  // Same result shapes as before, so Login.jsx is unchanged:
  //   { success, user } | { success:false, error } | { success:false, needsPicker, candidates }
  const login = async (pin) => {
    try {
      const { data } = await postJson('/api/auth?action=login', { pin })
      if (data?.ok && data.user) {
        signIn(data.user, data.token)
        return { success: true, user: data.user }
      }
      if (data?.needsPicker) {
        picker.current = data.picker
        return { success: false, needsPicker: true, candidates: data.candidates || [] }
      }
      return { success: false, error: data?.error || 'Login failed' }
    } catch (e) {
      return { success: false, error: 'Login failed' }
    }
  }

  // Finish a shared-PIN login for one of the people the server offered.
  const loginAs = async (userId) => {
    try {
      const { data } = await postJson('/api/auth?action=login-as', { picker: picker.current, user_id: userId })
      picker.current = null
      if (data?.ok && data.user) {
        signIn(data.user, data.token)
        return { success: true, user: data.user }
      }
      return { success: false, error: data?.error || 'Login failed' }
    } catch (e) {
      return { success: false, error: 'Login failed' }
    }
  }

  const logout = () => {
    picker.current = null
    signOut()
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

  // True if this PIN belongs to an active, non-disabled admin (/users). Checked on the server.
  const verifyAdminPin = async (pin) => {
    try {
      const { data } = await postJson('/api/auth?action=verify-admin', { pin })
      return data?.ok === true && data.valid === true
    } catch (e) {
      return false
    }
  }

  // Refresh user data (after permissions change)
  const refreshUser = async () => {
    if (user?.id) {
      await verifyUser()
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
