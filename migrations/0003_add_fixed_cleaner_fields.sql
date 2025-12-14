ALTER TABLE cleaners ADD COLUMN fixed_accommodations TEXT;
ALTER TABLE cleaners ADD COLUMN is_fixed BOOLEAN DEFAULT 0;