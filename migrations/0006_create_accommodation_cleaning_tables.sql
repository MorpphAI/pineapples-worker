CREATE TABLE IF NOT EXISTS accommodations (
    accommodation_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    status TEXT,
    area_m2 INTEGER,
    addr_type TEXT,
    address TEXT,
    number TEXT,
    door TEXT,
    city_name TEXT,
    latitude REAL,
    longitude REAL,
    last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS accommodation_cleaning_overrides (
    accommodation_id TEXT PRIMARY KEY,
    effort_units INTEGER CHECK (effort_units IS NULL OR effort_units IN (1, 2, 3)),
    estimated_minutes INTEGER CHECK (estimated_minutes IS NULL OR estimated_minutes > 0),
    required_people INTEGER CHECK (required_people IS NULL OR required_people IN (1, 2, 3)),
    zone_override TEXT,
    address_group_key_override TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    notes TEXT,
    updated_by TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (accommodation_id) REFERENCES accommodations(accommodation_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_accommodations_name ON accommodations(name);
CREATE INDEX IF NOT EXISTS idx_accommodations_status ON accommodations(status);
CREATE INDEX IF NOT EXISTS idx_accommodation_overrides_active ON accommodation_cleaning_overrides(is_active);
