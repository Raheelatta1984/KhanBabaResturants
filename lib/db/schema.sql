-- Khan Baba platform schema (SQLite; portable to Postgres with minor type changes)
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS staff (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL CHECK (role IN ('admin','manager','counter','kitchen','delivery')),
  password_hash TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS menu_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  tagline TEXT,
  description TEXT,
  category_id INTEGER REFERENCES categories(id),
  image TEXT,
  gallery TEXT,                       -- JSON array of image paths
  youtube_id TEXT,                    -- plays inline via youtube-nocookie
  ingredients TEXT,                   -- comma separated, customer facing
  allergens TEXT,                     -- comma separated
  spice_levels TEXT NOT NULL DEFAULT 'blend,mild,hot,extra_hot',
  prep_minutes INTEGER NOT NULL DEFAULT 15,
  is_veg INTEGER NOT NULL DEFAULT 0,
  is_available INTEGER NOT NULL DEFAULT 1,
  is_featured INTEGER NOT NULL DEFAULT 0,
  is_new INTEGER NOT NULL DEFAULT 0,
  published INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS item_variants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  size_ml INTEGER,
  price_cents INTEGER NOT NULL,
  is_default INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_variants_item ON item_variants(item_id);

CREATE TABLE IF NOT EXISTS reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
  order_code TEXT,
  customer_name TEXT NOT NULL,
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','published','hidden')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_reviews_item ON reviews(item_id, status);

-- Manufacturing / costing ---------------------------------------------------
CREATE TABLE IF NOT EXISTS materials (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  sku TEXT UNIQUE,
  unit TEXT NOT NULL DEFAULT 'kg',
  pack_qty REAL NOT NULL DEFAULT 1,          -- how much one purchase pack contains (in `unit`)
  pack_cost_cents INTEGER NOT NULL DEFAULT 0,
  stock_qty REAL NOT NULL DEFAULT 0,          -- current stock in `unit`
  reorder_level REAL NOT NULL DEFAULT 0,
  supplier TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS recipes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  output_kind TEXT NOT NULL DEFAULT 'batch' CHECK (output_kind IN ('menu_item','batch')),
  menu_item_id INTEGER REFERENCES menu_items(id),
  output_qty REAL NOT NULL DEFAULT 1,
  output_unit TEXT NOT NULL DEFAULT 'portion',
  prep_minutes INTEGER NOT NULL DEFAULT 30,
  notes TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS recipe_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  recipe_id INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  material_id INTEGER NOT NULL REFERENCES materials(id),
  qty REAL NOT NULL,
  unit TEXT
);
CREATE INDEX IF NOT EXISTS idx_recipe_lines ON recipe_lines(recipe_id);

CREATE TABLE IF NOT EXISTS production_batches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ref TEXT NOT NULL UNIQUE,
  recipe_id INTEGER NOT NULL REFERENCES recipes(id),
  planned_qty REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress','completed','cancelled')),
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT,
  created_by TEXT,
  total_cost_cents INTEGER NOT NULL DEFAULT 0,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS cost_postings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id INTEGER NOT NULL REFERENCES production_batches(id) ON DELETE CASCADE,
  material_id INTEGER NOT NULL REFERENCES materials(id),
  material_name TEXT NOT NULL,
  qty REAL NOT NULL,
  unit TEXT,
  unit_cost_cents INTEGER NOT NULL,
  amount_cents INTEGER NOT NULL,
  posted_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_cost_postings_batch ON cost_postings(batch_id);

-- Pricing -------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pricing_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('weekend','public_holiday','priority','peak')),
  calc TEXT NOT NULL CHECK (calc IN ('percent','flat')),
  value REAL NOT NULL,
  applies_to TEXT NOT NULL DEFAULT 'all',      -- all | delivery,pickup | delivery | pickup | dine_in | table
  days TEXT,                                   -- CSV 0=Sun..6=Sat, null = every day
  start_time TEXT,                             -- HH:MM (Sydney)
  end_time TEXT,
  min_subtotal_cents INTEGER NOT NULL DEFAULT 0,
  description TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS holidays (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL UNIQUE,                   -- YYYY-MM-DD
  name TEXT NOT NULL,
  surcharge_percent REAL,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS dining_tables (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  zone TEXT,
  seats INTEGER NOT NULL DEFAULT 4,
  active INTEGER NOT NULL DEFAULT 1
);

-- Orders --------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  channel TEXT NOT NULL CHECK (channel IN ('delivery','pickup','dine_in','table')),
  table_id INTEGER REFERENCES dining_tables(id),
  customer_name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  address TEXT,
  suburb TEXT,
  postcode TEXT,
  notes TEXT,
  subtotal_cents INTEGER NOT NULL DEFAULT 0,
  surcharge_cents INTEGER NOT NULL DEFAULT 0,
  surcharge_detail TEXT,
  priority INTEGER NOT NULL DEFAULT 0,
  priority_fee_cents INTEGER NOT NULL DEFAULT 0,
  delivery_fee_cents INTEGER NOT NULL DEFAULT 0,
  delivery_cost_cents INTEGER NOT NULL DEFAULT 0,
  total_cents INTEGER NOT NULL DEFAULT 0,
  payment_method TEXT NOT NULL CHECK (payment_method IN ('online','counter')),
  payment_status TEXT NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid','pending','paid','refunded','failed')),
  payment_ref TEXT,
  status TEXT NOT NULL DEFAULT 'pending_confirm' CHECK (status IN ('pending_confirm','confirmed','preparing','ready','out_for_delivery','awaiting_collection','completed','cancelled')),
  progress INTEGER NOT NULL DEFAULT 5,
  promised_at TEXT,
  confirmed_at TEXT,
  kitchen_started_at TEXT,
  ready_at TEXT,
  dispatched_at TEXT,
  completed_at TEXT,
  cancelled_reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_channel ON orders(channel, created_at DESC);

CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  item_id INTEGER,
  variant_id INTEGER,
  name TEXT NOT NULL,
  variant_label TEXT,
  size_ml INTEGER,
  spice_level TEXT,
  qty INTEGER NOT NULL DEFAULT 1,
  unit_price_cents INTEGER NOT NULL,
  line_total_cents INTEGER NOT NULL,
  notes TEXT,
  prep_state TEXT NOT NULL DEFAULT 'queued' CHECK (prep_state IN ('queued','preparing','ready'))
);
CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);

CREATE TABLE IF NOT EXISTS order_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  message TEXT NOT NULL,
  actor TEXT,
  progress INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_order_events ON order_events(order_id, created_at);

CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  intent_id TEXT,
  amount_cents INTEGER NOT NULL,
  status TEXT NOT NULL,
  method TEXT,
  last4 TEXT,
  raw TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  paid_at TEXT
);

-- Delivery ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS delivery_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  provider_quote_id TEXT,
  provider_delivery_id TEXT,
  cost_cents INTEGER NOT NULL DEFAULT 0,
  customer_fee_cents INTEGER NOT NULL DEFAULT 0,
  markup_cents INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'quoted' CHECK (status IN ('quoted','requested','accepted','pickup','dropoff','delivered','cancelled','failed')),
  courier_name TEXT,
  courier_phone TEXT,
  tracking_url TEXT,
  eta_minutes INTEGER,
  quote_json TEXT,
  external_status TEXT,
  triggered_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  dispatched_at TEXT,
  completed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_delivery_jobs_order ON delivery_jobs(order_id);

-- What's new / release notes ------------------------------------------------
CREATE TABLE IF NOT EXISTS whats_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  body TEXT,
  category TEXT NOT NULL DEFAULT 'feature' CHECK (category IN ('feature','improvement','fix','portal','ops')),
  version TEXT,
  pr_number INTEGER,
  pr_url TEXT,
  pinned INTEGER NOT NULL DEFAULT 0,
  published_at TEXT NOT NULL DEFAULT (datetime('now'))
);
