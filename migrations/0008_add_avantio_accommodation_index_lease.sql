ALTER TABLE avantio_accommodation_index_sync_state
ADD COLUMN lease_owner TEXT;

ALTER TABLE avantio_accommodation_index_sync_state
ADD COLUMN lease_expires_at TEXT;
