-- Migration number: 0001 	 2025-12-06T00:31:04.066Z
CREATE TABLE cleaners (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,              
    zones TEXT NOT NULL,             
    shift_start TEXT NOT NULL,       
    shift_end TEXT NOT NULL,         
    is_active BOOLEAN DEFAULT 1,     
    phone TEXT,                      
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);


CREATE INDEX idx_cleaners_active ON cleaners(is_active);