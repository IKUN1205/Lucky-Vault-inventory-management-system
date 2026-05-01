-- ============================================
-- Online Orders module — outbound shipment tracking
-- ============================================
-- Records online platform orders that Aldo (or anyone) ships out from
-- a warehouse. Decrements inventory at source_location_id but does NOT
-- track sale price / cost — purely a logistics / inventory-out record.
-- ============================================

CREATE TABLE IF NOT EXISTS online_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  platform TEXT NOT NULL,                          -- 'TikTok' | 'eBay'
  channel TEXT NOT NULL,                           -- 'RocketsHQ' | 'Packheads' | 'LuckyVaultUS' | 'SlabbiePatty'
  order_number TEXT,                               -- platform-side order id, optional
  customer_name TEXT,                              -- optional
  handled_by_id UUID REFERENCES users(id),         -- who packed/shipped (optional)
  source_location_id UUID NOT NULL REFERENCES locations(id),
  tracking_number TEXT,                            -- can be filled later
  notes TEXT,
  deleted BOOLEAN DEFAULT FALSE NOT NULL,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE TABLE IF NOT EXISTS online_order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES online_orders(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_online_orders_date ON online_orders(date DESC) WHERE deleted = false;
CREATE INDEX IF NOT EXISTS idx_online_orders_channel ON online_orders(channel) WHERE deleted = false;
CREATE INDEX IF NOT EXISTS idx_online_order_items_order ON online_order_items(order_id);

-- Verify tables exist
SELECT 'online_orders' AS table_name, count(*) AS row_count FROM online_orders
UNION ALL
SELECT 'online_order_items' AS table_name, count(*) AS row_count FROM online_order_items;
