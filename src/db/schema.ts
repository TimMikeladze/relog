export const CREATE_LOGS_TABLE = `
CREATE TABLE IF NOT EXISTS logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp TEXT NOT NULL,
  level TEXT NOT NULL,
  message TEXT NOT NULL,
  meta TEXT,
  service TEXT,
  host TEXT,
  pid INTEGER,
  trace_id TEXT,
  span_id TEXT,
  project TEXT,
  branch TEXT,
  created_at INTEGER NOT NULL
)`;

export const CREATE_INDEXES: string[] = [
	"CREATE INDEX IF NOT EXISTS idx_logs_created_at ON logs (created_at)",
	"CREATE INDEX IF NOT EXISTS idx_logs_level ON logs (level)",
	"CREATE INDEX IF NOT EXISTS idx_logs_service ON logs (service)",
	"CREATE INDEX IF NOT EXISTS idx_logs_trace_id ON logs (trace_id)",
	"CREATE INDEX IF NOT EXISTS idx_logs_level_created_at ON logs (level, created_at)",
	"CREATE INDEX IF NOT EXISTS idx_logs_service_created_at ON logs (service, created_at)",
	"CREATE INDEX IF NOT EXISTS idx_logs_project ON logs (project)",
	"CREATE INDEX IF NOT EXISTS idx_logs_branch ON logs (branch)",
	"CREATE INDEX IF NOT EXISTS idx_logs_project_branch_created_at ON logs (project, branch, created_at)",
];
