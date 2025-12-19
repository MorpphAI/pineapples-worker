CREATE TABLE cleaner_off_days (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    cleaner_id INTEGER NOT NULL,
    date TEXT NOT NULL,
    reason TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (cleaner_id) REFERENCES cleaners(id) ON DELETE CASCADE
);

CREATE INDEX idx_off_days_date ON cleaner_off_days(date);

CREATE INDEX idx_off_days_cleaner ON cleaner_off_days(cleaner_id);