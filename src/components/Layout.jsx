import React, { useState, useEffect } from 'react'
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
  Store,
  Gauge,
  LogOut,
  ShieldCheck,
  History,
  Layers,
  PlusCircle,
  ScanLine,
  CopyPlus,
  History as HistoryIcon,
  ChevronLeft,
  ChevronRight,
  Tv2
} from 'lucide-react'

// localStorage key for the icon-only-vs-expanded sidebar preference.
const SIDEBAR_COLLAPSED_KEY = 'lv:sidebar-collapsed'

// Sidebar grouped by workflow stage. Section headers render as small uppercase
// labels above each block. Order roughly matches the operational lifecycle:
// see what you have → receive → operate → sell → report → admin.
const navSections = [
  {
    // Manual Inventory lives in Overview (not Receive) — it's a quick
    // stock-adjust tool used to reconcile a known mismatch ("the system
    // says 10 but we count 8"), not a receive-from-vendor step. Keeping
    // it adjacent to View Inventory makes that "check then nudge" flow
    // a single sidebar group.
    title: 'Overview',
    items: [
      { path: '/', label: 'Dashboard', icon: Home },
      { path: '/inventory', label: 'View Inventory', icon: Eye },
      { path: '/manual-inventory', label: 'Manual Inventory', icon: PackagePlus },
    ]
  },
  {
    title: 'Receive',
    items: [
      { path: '/purchased-items', label: 'Purchased Items', icon: ShoppingCart },
      { path: '/intake', label: 'Intake to Master', icon: Package },
      { path: '/storefront-import', label: 'Storefront Import', icon: Store },
    ]
  },
  {
    // Add Product + Product Barcodes live in Operations (not Receive /
    // Admin respectively) — both are catalog-maintenance tools: Add
    // Product creates a SKU, Product Barcodes attaches a UPC to one.
    // Pairing them here lets staff "add then label" in one trip without
    // jumping sections.
    title: 'Operations',
    items: [
      { path: '/move-inventory', label: 'Move Inventory', icon: ArrowRightLeft },
      { path: '/break-box', label: 'Break Box', icon: Box },
      { path: '/add-product', label: 'Add Product', icon: Plus },
      { path: '/product-barcodes', label: 'Product Barcodes', icon: ScanLine },
    ]
  },
  {
    title: 'Sales',
    items: [
      { path: '/stream-counts', label: 'Stream Counts', icon: ClipboardList },
      { path: '/stream-sessions', label: 'Session History', icon: History },
      { path: '/platform-sales', label: 'Platform Sales', icon: TrendingUp },
      { path: '/online-orders', label: 'Online Orders', icon: ShoppingBag },
      { path: '/storefront-sale', label: 'Storefront Sales', icon: Store },
    ]
  },
  {
    title: 'Reports',
    items: [
      { path: '/reports', label: 'Reports', icon: BarChart3 },
      { path: '/turnover', label: 'Turnover', icon: Gauge },
      { path: '/executive-report', label: 'Executive Report', icon: TrendingUp },
      { path: '/audit-history', label: 'Audit History', icon: ShieldCheck },
    ]
  },
  {
    // Singles workflow simplification (per boss directive 2026-05-15):
    // Scan is the primary entry point for both intake (single + batch) and
    // sell. Add Single and Bulk Add pages still EXIST and are reachable via
    // Scan's deep-links (?cert= / ?certs= URLs), but no longer in the
    // sidebar — scanner is the daily-driver path.
    // Unified Singles + Slabs section (per user directive 2026-05-15):
    // Inventory page has a Singles/Slabs tab at the top so both card
    // types live on one page. Scan + Activity Log are still
    // singles-specific for now — slab versions of those land later.
    title: 'Cards',
    items: [
      { path: '/cards',        label: 'Inventory',    icon: Layers },
      { path: '/cards/scan',   label: 'Scan',         icon: ScanLine },
      { path: '/cards/log',    label: 'Activity Log', icon: HistoryIcon },
    ]
  },
  {
    // Japan inventory system (2026-05-21). Lightweight branch that lives
    // inside the same DB — Japan Warehouse location + jp_vendor /
    // jp_to_us_shipment acquisition origins. Japan team only needs these
    // four pages; the rest of the app's permissions can stay off.
    title: 'Japan 🇯🇵',
    items: [
      { path: '/jp/inventory',     label: '日本库存',       icon: Package },
      { path: '/jp/acquisitions',  label: '日本进货',       icon: ShoppingCart },
      { path: '/jp/stream-sales',  label: '日本直播售卖',   icon: Tv2 },
      { path: '/jp/shipments',     label: '日本→美国发货',  icon: Truck },
      { path: '/jp/log',           label: '日本日志',       icon: HistoryIcon },
      { path: '/jp/add-product',   label: '日本新增 SKU',   icon: Plus },
    ]
  },
  {
    title: 'Admin',
    items: [
      { path: '/high-value', label: 'High Value', icon: Star },
      { path: '/expenses', label: 'Business Expenses', icon: Receipt },
      { path: '/audit', label: 'Sales Audit', icon: ShieldCheck },
      { path: '/users', label: 'Team Management', icon: Users },
    ]
  },
]

export default function Layout({ children }) {
  // Mobile slide-in state (unchanged) — controls the off-canvas drawer on
  // small screens. Always opens fully expanded; collapsed mode doesn't apply
  // to mobile since the drawer is already temporary.
  const [sidebarOpen, setSidebarOpen] = useState(false)

  // Desktop collapse state. When true, sidebar shrinks to icon-only (~64px)
  // and shows hover tooltips. Defaults from localStorage so the preference
  // survives page reloads.
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false
    return window.localStorage?.getItem(SIDEBAR_COLLAPSED_KEY) === '1'
  })

  // Persist collapsed preference whenever it changes.
  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage?.setItem(SIDEBAR_COLLAPSED_KEY, collapsed ? '1' : '0')
  }, [collapsed])

  const location = useLocation()
  const { user, hasAccess, logout } = useAuth()

  const isActive = (path) => location.pathname === path

  // Filter each section's items by user permissions, then drop sections that
  // become empty (e.g. a streamer with no Admin access shouldn't see an empty
  // "Admin" header).
  const visibleSections = navSections
    .map(section => ({
      ...section,
      items: section.items.filter(item => hasAccess(item.path))
    }))
    .filter(section => section.items.length > 0)

  const handleLogout = () => {
    if (confirm('Are you sure you want to logout?')) {
      logout()
    }
  }

  return (
    // h-screen (not min-h-screen) so the document height equals the viewport
    // and the sidebar/main can scroll INDEPENDENTLY via their own overflow:auto
    // rather than the whole page scrolling together (which made the sidebar
    // fly off-screen when the main content was tall — e.g. Singles Inventory).
    <div className="h-screen flex overflow-hidden">
      {/* Mobile menu button */}
      <button
        className="lg:hidden fixed top-4 left-4 z-50 p-2 bg-vault-surface rounded-lg border border-vault-border"
        onClick={() => setSidebarOpen(!sidebarOpen)}
      >
        {sidebarOpen ? <X size={24} /> : <Menu size={24} />}
      </button>

      {/* Sidebar.
          Width is driven by `collapsed` on lg+. On mobile the full-width
          drawer always slides in fully expanded — collapsed mode is for
          desktop power users who want more screen real estate. */}
      <aside className={`
        fixed lg:static inset-y-0 left-0 z-40
        ${collapsed ? 'lg:w-16' : 'lg:w-64'} w-64
        bg-vault-darker border-r border-vault-border
        transform transition-all duration-200 ease-in-out flex flex-col
        ${sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
      `}>
        {/* Logo + collapse toggle. In EXPANDED mode they share a row (logo
            on the left, chevron on the right). In COLLAPSED mode the 64px
            width can't fit both side-by-side, so we stack vertically — LV
            badge on top, chevron below, both centered. Prevents the overlap
            that the previous side-by-side layout had at narrow widths. */}
        <div className={`border-b border-vault-border ${collapsed ? 'p-3' : 'p-6'}`}>
          <div className={collapsed
            ? 'flex flex-col items-center gap-2'
            : 'flex items-center justify-between gap-2'}>
            <Link to="/" className={collapsed
              ? 'flex items-center justify-center'
              : 'flex items-center gap-3 min-w-0'}>
              <div className="w-10 h-10 bg-gradient-to-br from-vault-gold to-amber-600 rounded-lg flex items-center justify-center flex-shrink-0">
                <span className="font-display font-bold text-vault-dark text-lg">LV</span>
              </div>
              {!collapsed && (
                <div className="min-w-0">
                  <h1 className="font-display font-bold text-lg text-white truncate">LUCKY VAULT</h1>
                  <p className="text-xs text-gray-400">Inventory System</p>
                </div>
              )}
            </Link>
            {/* Desktop-only collapse toggle. Hidden on mobile because the
                drawer there has its own hamburger button. */}
            <button
              onClick={() => setCollapsed(c => !c)}
              className="hidden lg:flex p-1.5 rounded-md text-gray-400 hover:text-white hover:bg-vault-surface flex-shrink-0"
              title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            >
              {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
            </button>
          </div>
        </div>

        {/* Navigation — rendered as sections with small uppercase headers.
            When collapsed (whole sidebar), the section headers hide and
            items show icon-only with hover tooltips (title attribute). */}
        <nav className={`overflow-y-auto flex-1 ${collapsed ? 'p-2' : 'p-3'}`}>
          {visibleSections.map((section, sectionIdx) => (
            <div key={section.title} className={sectionIdx > 0 ? 'mt-4' : ''}>
              {!collapsed && (
                <div className="px-3 mb-1 text-[10px] font-semibold uppercase tracking-wider text-gray-500">
                  {section.title}
                </div>
              )}
              <div className="space-y-0.5">
                {section.items.map((item) => (
                  <Link
                    key={item.path}
                    to={item.path}
                    onClick={() => setSidebarOpen(false)}
                    title={collapsed ? item.label : undefined}
                    className={`
                      flex items-center gap-3 rounded-lg transition-all
                      ${collapsed ? 'justify-center px-2 py-2.5' : 'px-3 py-2'}
                      ${isActive(item.path)
                        ? 'bg-vault-gold/10 text-vault-gold border border-vault-gold/30'
                        : 'text-gray-400 hover:bg-vault-surface hover:text-white'}
                    `}
                  >
                    <item.icon size={18} className="flex-shrink-0" />
                    {!collapsed && <span className="text-sm font-medium truncate">{item.label}</span>}
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </nav>

        {/* User Info & Logout. In collapsed mode we stack the avatar above
            the logout icon, both centered — same info, just vertical. */}
        <div className={`border-t border-vault-border ${collapsed ? 'p-2' : 'p-4'}`}>
          {collapsed ? (
            <div className="flex flex-col items-center gap-2">
              <div
                className="w-8 h-8 rounded-full bg-vault-gold/20 flex items-center justify-center"
                title={`${user?.name || 'User'} (${user?.role || 'Member'})`}
              >
                <span className="text-vault-gold text-sm font-semibold">
                  {user?.name?.charAt(0)?.toUpperCase() || '?'}
                </span>
              </div>
              <button
                onClick={handleLogout}
                className="p-2 text-gray-400 hover:text-red-400 transition-colors"
                title="Logout"
              >
                <LogOut size={18} />
              </button>
            </div>
          ) : (
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
          )}
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
