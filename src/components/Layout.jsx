import React, { useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useAuth } from '../lib/AuthContext'
import { 
  Home, 
  Package, 
  ShoppingCart, 
  Truck,
  Receipt, 
  ArrowRightLeft,
  Box,
  Diamond,
  DollarSign,
  Eye,
  Star,
  BarChart3,
  Menu,
  X,
  Plus,
  PackagePlus,
  ClipboardList,
  TrendingUp,
  Link2,
  Users,
  ShoppingBag,
  Gauge,
  LogOut
} from 'lucide-react'

const navItems = [
  { path: '/', label: 'Dashboard', icon: Home },
  { path: '/inventory', label: 'View Inventory', icon: Eye },
  { path: '/move-inventory', label: 'Move Inventory', icon: ArrowRightLeft },
  { path: '/online-orders', label: 'Online Orders', icon: ShoppingBag },
  { path: '/manual-inventory', label: 'Manual Inventory', icon: PackagePlus },
  { path: '/stream-counts', label: 'Stream Counts', icon: ClipboardList },
  { path: '/platform-sales', label: 'Platform Sales', icon: TrendingUp },
  { path: '/add-product', label: 'Add Product', icon: Plus },
  { path: '/purchased-items', label: 'Purchased Items', icon: ShoppingCart },
  { path: '/intake', label: 'Intake to Master', icon: Package },
  { path: '/break-box', label: 'Break Box', icon: Box },
  { path: '/expenses', label: 'Business Expenses', icon: Receipt },
  { path: '/reports', label: 'Reports', icon: BarChart3 },
  { path: '/turnover', label: 'Turnover', icon: Gauge },
  { path: '/users', label: 'Team Management', icon: Users },
  { path: '/high-value', label: 'High Value', icon: Star },
]

export default function Layout({ children }) {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const location = useLocation()
  const { user, hasAccess, logout } = useAuth()

  const isActive = (path) => location.pathname === path

  // Filter nav items based on user permissions
  const visibleNavItems = navItems.filter(item => hasAccess(item.path))

  const handleLogout = () => {
    if (confirm('Are you sure you want to logout?')) {
      logout()
    }
  }

  return (
    <div className="min-h-screen flex">
      {/* Mobile menu button */}
      <button
        className="lg:hidden fixed top-4 left-4 z-50 p-2 bg-vault-surface rounded-lg border border-vault-border"
        onClick={() => setSidebarOpen(!sidebarOpen)}
      >
        {sidebarOpen ? <X size={24} /> : <Menu size={24} />}
      </button>

      {/* Sidebar */}
      <aside className={`
        fixed lg:static inset-y-0 left-0 z-40
        w-64 bg-vault-darker border-r border-vault-border
        transform transition-transform duration-300 ease-in-out flex flex-col
        ${sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
      `}>
        {/* Logo */}
        <div className="p-6 border-b border-vault-border">
          <Link to="/" className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-vault-gold to-amber-600 rounded-lg flex items-center justify-center">
              <span className="font-display font-bold text-vault-dark text-lg">LV</span>
            </div>
            <div>
              <h1 className="font-display font-bold text-lg text-white">LUCKY VAULT</h1>
              <p className="text-xs text-gray-400">Inventory System</p>
            </div>
          </Link>
        </div>

        {/* Navigation */}
        <nav className="p-4 space-y-1 overflow-y-auto flex-1">
          {visibleNavItems.map((item) => (
            <Link
              key={item.path}
              to={item.path}
              onClick={() => setSidebarOpen(false)}
              className={`
                flex items-center gap-3 px-4 py-3 rounded-lg transition-all
                ${isActive(item.path) 
                  ? 'bg-vault-gold/10 text-vault-gold border border-vault-gold/30' 
                  : 'text-gray-400 hover:bg-vault-surface hover:text-white'}
              `}
            >
              <item.icon size={20} />
              <span className="text-sm font-medium">{item.label}</span>
            </Link>
          ))}
        </nav>

        {/* User Info & Logout */}
        <div className="p-4 border-t border-vault-border">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-8 h-8 rounded-full bg-vault-gold/20 flex items-center justify-center flex-shrink-0">
                <span className="text-vault-gold text-sm font-semibold">
                  {user?.name?.charAt(0)?.toUpperCase() || '?'}
                </span>
              </div>
              <div className="min-w-0">
                <p className="text-white text-sm font-medium truncate">{user?.name || 'User'}</p>
                <p className="text-gray-500 text-xs">{user?.role || 'Member'}</p>
              </div>
            </div>
            <button
              onClick={handleLogout}
              className="p-2 text-gray-400 hover:text-red-400 transition-colors"
              title="Logout"
            >
              <LogOut size={18} />
            </button>
          </div>
        </div>
      </aside>

      {/* Mobile overlay */}
      {sidebarOpen && (
        <div 
          className="lg:hidden fixed inset-0 bg-black/50 z-30"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Main content */}
      <main className="flex-1 overflow-auto">
        <div className="p-6 lg:p-8 max-w-7xl mx-auto">
          {children}
        </div>
      </main>
    </div>
  )
}
