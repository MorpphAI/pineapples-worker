-- Migration number: 0005 	 2026-03-28T00:00:00.000Z
ALTER TABLE schedule_items ADD COLUMN accommodation_id TEXT;
ALTER TABLE schedule_items ADD COLUMN stay_duration INTEGER;
