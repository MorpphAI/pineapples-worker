-- Migration number: 0002 	 2025-12-06T18:12:14.936Z
CREATE TABLE schedule_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    target_date TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    status TEXT DEFAULT 'DRAFT'
);

CREATE TABLE schedule_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id INTEGER NOT NULL,             
    zone TEXT NOT NULL,                  
    accommodation_code TEXT NOT NULL,    
    is_turnover BOOLEAN NOT NULL,        
    cleaner_name TEXT,                   
    start_time TEXT,                     
    end_time TEXT,                       
    address TEXT,
    
    FOREIGN KEY (run_id) REFERENCES schedule_runs(id) ON DELETE CASCADE
);

CREATE INDEX idx_runs_date ON schedule_runs(target_date);
CREATE INDEX idx_items_run ON schedule_items(run_id);