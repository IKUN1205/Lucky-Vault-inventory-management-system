import React from 'react'
import { Link } from 'react-router-dom'
import { 
  Package, 
  ShoppingCart, 
  Receipt,
  ArrowRightLeft,
  Box,
  Diamond,
  DollarSign,
  Eye,
  Star,
  BarChart3,
  Plus,
  PackagePlus,
  ClipboardList
} from 'lucide-react'

const actions = [
  { 
    path: '/stream-counts', 
    label: 'Stream Counts', 
    icon: ClipboardList, 
    color: 'from-vault-gold to-amber-600'
  },
  { 
    path: '/add-product', 
    label: 'Add New Product', 
    icon: Plus, 
    color: 'from-emerald-500 to-emerald-700'
  },
  { 
    path: '/manual-inventory', 
    label: 'Manual Inventory', 
    icon: PackagePlus, 
    color: 'from-teal-500 to-teal-700'
  },
  { 
    path: '/purchased-items', 
    label: 'Purchased Items', 
    icon: ShoppingCart, 
    color: 'from-blue-500 to-blue-700' 
  },
  { 
    path: '/expenses', 
    label: 'Business Expenses', 
    icon: Receipt, 
    color: 'from-purple-500 to-purple-700' 
  },
  { 
    path: '/intake', 
    label: 'Intake to Master', 
    icon: Package, 
    color: 'from-cyan-500 to-cyan-700' 
  },
  { 
    path: '/move-inventory', 
    label: 'Move Inventory', 
    icon: ArrowRightLeft, 
    color: 'from-orange-500 to-orange-700' 
  },
  { 
    path: '/break-box', 
    label: 'Break Box', 
    icon: Box, 
    color: 'from-pink-500 to-pink-700' 
  },
  { 
    path: '/grading', 
    label: 'Send to Grading', 
    icon: Diamond, 
    color: 'from-indigo-500 to-indigo-700' 
  },
  { 
    path: '/storefront-sale', 
    label: 'Storefront Sale', 
    icon: DollarSign, 
    color: 'from-green-500 to-green-700' 
  },
  { 
    path: '/inventory', 
    label: 'View Inventory', 
    icon: Eye, 
    color: 'from-slate-500 to-slate-700' 
  },
  { 
    path: '/high-value', 
    label: 'High Value Tracking', 
    icon: Star, 
    color: 'from-yellow-500 to-amber-600'
  },
  { 
    path: '/reports', 
    label: 'Reports', 
    icon: BarChart3, 
    color: 'from-red-500 to-red-700'
  },
]

export default function Dashboard() {
  return (
    <div className="fade-in">
      {/* Header */}
      <div className="mb-8">
        <h1 className="font-display text-3xl font-bold text-white mb-2">
          Welcome to Lucky Vault
        </h1>
        <p className="text-gray-400">What do you want to do today?</p>
      </div>

      {/* Action Grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {actions.map((action) => (
          <Link
            key={action.path}
            to={action.path}
            className="action-card group"
          >
            <div className={`w-14 h-14 rounded-xl bg-gradient-to-br ${action.color} flex items-center justify-center shadow-lg group-hover:scale-110 transition-transform`}>
              <action.icon className="text-white" size={28} />
            </div>
            <span className="label text-gray-300 group-hover:text-white transition-colors">
              {action.label}
            </span>
          </Link>
        ))}
      </div>

      {/* Quick Stats Preview */}
      <div className="mt-8 grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="card">
          <p className="text-gray-400 text-sm mb-1">Today's Purchases</p>
          <p className="font-display text-2xl font-bold text-white">--</p>
        </div>
        <div className="card">
          <p className="text-gray-400 text-sm mb-1">Pending Intake</p>
          <p className="font-display text-2xl font-bold text-yellow-400">--</p>
        </div>
        <div className="card">
          <p className="text-gray-400 text-sm mb-1">In Grading</p>
          <p className="font-display text-2xl font-bold text-purple-400">--</p>
        </div>
      </div>
    </div>
  )
}
