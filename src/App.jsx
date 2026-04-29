import React from 'react'
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { AuthProvider, useAuth } from './lib/AuthContext'

// Pages
import Login from './pages/Login'
import AccessDenied from './pages/AccessDenied'
import Dashboard from './pages/Dashboard'
import PurchasedItems from './pages/PurchasedItems'
import IntakeToMaster from './pages/IntakeToMaster'
import MovedInventory from './pages/MovedInventory'
import BreakBox from './pages/BreakBox'
import SendToGrading from './pages/SendToGrading'
import StorefrontSale from './pages/StorefrontSale'
import BusinessExpenses from './pages/BusinessExpenses'
import ViewInventory from './pages/ViewInventory'
import HighValueTracking from './pages/HighValueTracking'
import AddProduct from './pages/AddProduct'
import ManualInventory from './pages/ManualInventory'
import Reports from './pages/Reports'
import StreamCounts from './pages/StreamCounts'
import PlatformSales from './pages/PlatformSales'
import ProductMapping from './pages/ProductMapping'
import UserManagement from './pages/UserManagement'

// Components
import Layout from './components/Layout'

// Protected Route wrapper
function ProtectedRoute({ children, path }) {
  const { user, loading, hasAccess } = useAuth()
  const location = useLocation()

  if (loading) {
    return (
      <div className="min-h-screen bg-vault-darker flex items-center justify-center">
        <div className="spinner"></div>
      </div>
    )
  }

  if (!user) {
    return <Login />
  }

  if (!hasAccess(path)) {
    return <AccessDenied />
  }

  return children
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/access-denied" element={<AccessDenied />} />
      <Route path="/" element={
        <ProtectedRoute path="/"><Layout><Dashboard /></Layout></ProtectedRoute>
      } />
      <Route path="/stream-counts" element={
        <ProtectedRoute path="/stream-counts"><Layout><StreamCounts /></Layout></ProtectedRoute>
      } />
      <Route path="/platform-sales" element={
        <ProtectedRoute path="/platform-sales"><Layout><PlatformSales /></Layout></ProtectedRoute>
      } />
      <Route path="/purchased-items" element={
        <ProtectedRoute path="/purchased-items"><Layout><PurchasedItems /></Layout></ProtectedRoute>
      } />
      <Route path="/intake" element={
        <ProtectedRoute path="/intake"><Layout><IntakeToMaster /></Layout></ProtectedRoute>
      } />
      <Route path="/move-inventory" element={
        <ProtectedRoute path="/move-inventory"><Layout><MovedInventory /></Layout></ProtectedRoute>
      } />
      <Route path="/break-box" element={
        <ProtectedRoute path="/break-box"><Layout><BreakBox /></Layout></ProtectedRoute>
      } />
      <Route path="/grading" element={
        <ProtectedRoute path="/grading"><Layout><SendToGrading /></Layout></ProtectedRoute>
      } />
      <Route path="/storefront-sale" element={
        <ProtectedRoute path="/storefront-sale"><Layout><StorefrontSale /></Layout></ProtectedRoute>
      } />
      <Route path="/expenses" element={
        <ProtectedRoute path="/expenses"><Layout><BusinessExpenses /></Layout></ProtectedRoute>
      } />
      <Route path="/inventory" element={
        <ProtectedRoute path="/inventory"><Layout><ViewInventory /></Layout></ProtectedRoute>
      } />
      <Route path="/high-value" element={
        <ProtectedRoute path="/high-value"><Layout><HighValueTracking /></Layout></ProtectedRoute>
      } />
      <Route path="/add-product" element={
        <ProtectedRoute path="/add-product"><Layout><AddProduct /></Layout></ProtectedRoute>
      } />
      <Route path="/manual-inventory" element={
        <ProtectedRoute path="/manual-inventory"><Layout><ManualInventory /></Layout></ProtectedRoute>
      } />
      <Route path="/reports" element={
        <ProtectedRoute path="/reports"><Layout><Reports /></Layout></ProtectedRoute>
      } />
      <Route path="/product-mapping" element={
        <ProtectedRoute path="/product-mapping"><Layout><ProductMapping /></Layout></ProtectedRoute>
      } />
      <Route path="/users" element={
        <ProtectedRoute path="/users"><Layout><UserManagement /></Layout></ProtectedRoute>
      } />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  )
}

export default App
