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
import OnlineOrders from './pages/OnlineOrders'
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
import ProductBarcodes from './pages/ProductBarcodes'
import UserManagement from './pages/UserManagement'
import Turnover from './pages/Turnover'
import ExecutiveReport from './pages/ExecutiveReport'
import WeeklyUsage from './pages/WeeklyUsage'
import Audit from './pages/Audit'
import StorefrontImport from './pages/StorefrontImport'
import StreamSessions from './pages/StreamSessions'
import AuditHistory from './pages/AuditHistory'
import SinglesInventory from './pages/SinglesInventory'
import AddSingle from './pages/AddSingle'
import SinglesScan from './pages/SinglesScan'
import BulkAddSingles from './pages/BulkAddSingles'
import SinglesLog from './pages/SinglesLog'
import SlabsInventory from './pages/SlabsInventory'
import SlabsScan from './pages/SlabsScan'
import Inventory from './pages/Inventory'
import CardsScan from './pages/CardsScan'
import CardsLog from './pages/CardsLog'
import CardsAudit from './pages/CardsAudit'
import JapanInventory from './pages/JapanInventory'
import JapanAcquisitions from './pages/JapanAcquisitions'
import JapanStreamSales from './pages/JapanStreamSales'
import JapanLocalSales from './pages/JapanLocalSales'
import JapanShipments from './pages/JapanShipments'
import JapanLog from './pages/JapanLog'
import JapanAddProduct from './pages/JapanAddProduct'

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
    // Special case: user lands on "/" but doesn't have Dashboard access.
    // Without this, restricted-role users (e.g. Streamer with only
    // /stream-counts) would hit Access Denied immediately after login
    // and have no obvious way out. Redirect them to whatever page they
    // CAN access. If they have zero allowed pages, fall through to
    // Access Denied (which shows a Logout escape hatch).
    if (path === '/') {
      const fallback = (user.allowed_pages || []).find(p => p !== '/')
      if (fallback) {
        return <Navigate to={fallback} replace />
      }
    }
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
      <Route path="/online-orders" element={
        <ProtectedRoute path="/online-orders"><Layout><OnlineOrders /></Layout></ProtectedRoute>
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
      <Route path="/turnover" element={
        <ProtectedRoute path="/turnover"><Layout><Turnover /></Layout></ProtectedRoute>
      } />
      <Route path="/weekly-usage" element={
        <ProtectedRoute path="/weekly-usage"><Layout><WeeklyUsage /></Layout></ProtectedRoute>
      } />
      <Route path="/executive-report" element={
        <ProtectedRoute path="/executive-report"><Layout><ExecutiveReport /></Layout></ProtectedRoute>
      } />
      <Route path="/product-mapping" element={
        <ProtectedRoute path="/product-mapping"><Layout><ProductMapping /></Layout></ProtectedRoute>
      } />
      <Route path="/product-barcodes" element={
        <ProtectedRoute path="/product-barcodes"><Layout><ProductBarcodes /></Layout></ProtectedRoute>
      } />
      <Route path="/users" element={
        <ProtectedRoute path="/users"><Layout><UserManagement /></Layout></ProtectedRoute>
      } />
      <Route path="/audit" element={
        <ProtectedRoute path="/audit"><Layout><Audit /></Layout></ProtectedRoute>
      } />
      <Route path="/storefront-import" element={
        <ProtectedRoute path="/storefront-import"><Layout><StorefrontImport /></Layout></ProtectedRoute>
      } />
      <Route path="/stream-sessions" element={
        <ProtectedRoute path="/stream-sessions"><Layout><StreamSessions /></Layout></ProtectedRoute>
      } />
      <Route path="/audit-history" element={
        <ProtectedRoute path="/audit-history"><Layout><AuditHistory /></Layout></ProtectedRoute>
      } />
      <Route path="/singles" element={
        <ProtectedRoute path="/singles"><Layout><SinglesInventory /></Layout></ProtectedRoute>
      } />
      <Route path="/singles/add" element={
        <ProtectedRoute path="/singles/add"><Layout><AddSingle /></Layout></ProtectedRoute>
      } />
      <Route path="/singles/scan" element={
        <ProtectedRoute path="/singles/scan"><Layout><SinglesScan /></Layout></ProtectedRoute>
      } />
      <Route path="/singles/bulk-add" element={
        <ProtectedRoute path="/singles/bulk-add"><Layout><BulkAddSingles /></Layout></ProtectedRoute>
      } />
      <Route path="/singles/log" element={
        <ProtectedRoute path="/singles/log"><Layout><SinglesLog /></Layout></ProtectedRoute>
      } />
      <Route path="/slabs" element={
        <ProtectedRoute path="/slabs"><Layout><SlabsInventory /></Layout></ProtectedRoute>
      } />
      <Route path="/cards" element={
        <ProtectedRoute path="/singles"><Layout><Inventory /></Layout></ProtectedRoute>
      } />
      <Route path="/cards/scan" element={
        <ProtectedRoute path="/singles"><Layout><CardsScan /></Layout></ProtectedRoute>
      } />
      <Route path="/cards/log" element={
        <ProtectedRoute path="/singles"><Layout><CardsLog /></Layout></ProtectedRoute>
      } />
      <Route path="/cards/audit" element={
        <ProtectedRoute path="/cards/audit"><Layout><CardsAudit /></Layout></ProtectedRoute>
      } />
      {/* Japan inventory system — see scripts/add_japan_inventory_system.sql */}
      <Route path="/jp/inventory" element={
        <ProtectedRoute path="/jp/inventory"><Layout><JapanInventory /></Layout></ProtectedRoute>
      } />
      <Route path="/jp/acquisitions" element={
        <ProtectedRoute path="/jp/acquisitions"><Layout><JapanAcquisitions /></Layout></ProtectedRoute>
      } />
      <Route path="/jp/stream-sales" element={
        <ProtectedRoute path="/jp/stream-sales"><Layout><JapanStreamSales /></Layout></ProtectedRoute>
      } />
      <Route path="/jp/local-sales" element={
        <ProtectedRoute path="/jp/local-sales"><Layout><JapanLocalSales /></Layout></ProtectedRoute>
      } />
      <Route path="/jp/shipments" element={
        <ProtectedRoute path="/jp/shipments"><Layout><JapanShipments /></Layout></ProtectedRoute>
      } />
      <Route path="/jp/log" element={
        <ProtectedRoute path="/jp/log"><Layout><JapanLog /></Layout></ProtectedRoute>
      } />
      <Route path="/jp/add-product" element={
        <ProtectedRoute path="/jp/add-product"><Layout><JapanAddProduct /></Layout></ProtectedRoute>
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
