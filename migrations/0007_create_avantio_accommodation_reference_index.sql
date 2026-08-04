CREATE TABLE IF NOT EXISTS avantio_accommodation_reference_index (
    generation_id TEXT NOT NULL,
    accommodation_id TEXT NOT NULL,
    external_reference TEXT,
    name TEXT,
    remote_status TEXT,
    inspected_at TEXT NOT NULL,
    PRIMARY KEY (generation_id, accommodation_id)
);

CREATE INDEX IF NOT EXISTS idx_avantio_accommodation_reference_exact
    ON avantio_accommodation_reference_index(generation_id, external_reference COLLATE BINARY);

CREATE TABLE IF NOT EXISTS avantio_accommodation_index_sync_state (
    singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
    active_generation_id TEXT,
    building_generation_id TEXT,
    next_page_url TEXT,
    status TEXT NOT NULL CHECK (status IN ('idle', 'building', 'complete', 'failed')),
    started_at TEXT,
    completed_at TEXT,
    updated_at TEXT NOT NULL,
    processed_records INTEGER NOT NULL DEFAULT 0,
    processed_pages INTEGER NOT NULL DEFAULT 0,
    last_error_code TEXT
);

INSERT OR IGNORE INTO avantio_accommodation_index_sync_state (
    singleton_id,
    status,
    updated_at
) VALUES (1, 'idle', CURRENT_TIMESTAMP);
