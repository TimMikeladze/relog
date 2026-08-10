/**
 * Web-analytics schema.
 *
 * Four tables, all written in one transaction per collect batch:
 *
 * - `events`         raw event stream. Prunable/archivable — everything the
 *                    dashboard needs survives in the rollups below.
 * - `event_rollups`  pre-aggregated view counts per hour × dimension tuple.
 *                    Keeps dashboards O(buckets) instead of O(events).
 * - `visitor_hours`  one row per (site, hour, visitor). Unique-visitor counts
 *                    cannot be summed across rollup buckets, so uniques are
 *                    counted here instead — cardinality is bounded by real
 *                    humans, not pageviews.
 * - `sessions`       one row per session, upserted on every event. Source of
 *                    bounce rate, session duration, entry/exit pages.
 */

export const CREATE_EVENTS_TABLE = `
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site TEXT NOT NULL,
  name TEXT NOT NULL,
  visitor_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  hostname TEXT,
  path TEXT,
  path_raw TEXT,
  title TEXT,
  referrer_host TEXT,
  referrer_path TEXT,
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  utm_term TEXT,
  utm_content TEXT,
  country TEXT,
  region TEXT,
  city TEXT,
  browser TEXT,
  os TEXT,
  device TEXT,
  screen TEXT,
  language TEXT,
  props TEXT,
  revenue REAL,
  duration_ms REAL,
  key_prefix TEXT,
  created_at INTEGER NOT NULL
)`;

/**
 * `bucket` is an epoch-ms hour boundary. The dimension columns are the ones
 * the dashboard groups by; anything higher-cardinality (title, path_raw,
 * custom props) intentionally stays out so the rollup table cannot blow up.
 * NULLs are normalized to '' at write time — SQLite treats NULLs as distinct
 * in UNIQUE indexes, which would defeat the upsert.
 */
export const CREATE_EVENT_ROLLUPS_TABLE = `
CREATE TABLE IF NOT EXISTS event_rollups (
  site TEXT NOT NULL,
  bucket INTEGER NOT NULL,
  name TEXT NOT NULL,
  path TEXT NOT NULL,
  referrer_host TEXT NOT NULL,
  utm_source TEXT NOT NULL,
  utm_medium TEXT NOT NULL,
  utm_campaign TEXT NOT NULL,
  country TEXT NOT NULL,
  device TEXT NOT NULL,
  browser TEXT NOT NULL,
  os TEXT NOT NULL,
  views INTEGER NOT NULL DEFAULT 0,
  revenue REAL NOT NULL DEFAULT 0,
  duration_sum REAL NOT NULL DEFAULT 0,
  duration_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (site, bucket, name, path, referrer_host, utm_source, utm_medium, utm_campaign, country, device, browser, os)
) WITHOUT ROWID`;

export const CREATE_VISITOR_HOURS_TABLE = `
CREATE TABLE IF NOT EXISTS visitor_hours (
  site TEXT NOT NULL,
  bucket INTEGER NOT NULL,
  visitor_id TEXT NOT NULL,
  PRIMARY KEY (site, bucket, visitor_id)
) WITHOUT ROWID`;

export const CREATE_SESSIONS_TABLE = `
CREATE TABLE IF NOT EXISTS sessions (
  site TEXT NOT NULL,
  session_id TEXT NOT NULL,
  visitor_id TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  views INTEGER NOT NULL DEFAULT 0,
  events INTEGER NOT NULL DEFAULT 0,
  entry_path TEXT,
  exit_path TEXT,
  referrer_host TEXT,
  utm_source TEXT,
  country TEXT,
  device TEXT,
  browser TEXT,
  os TEXT,
  PRIMARY KEY (site, session_id)
) WITHOUT ROWID`;

/**
 * The daily salt used to derive `visitor_id`. Persisted so a server restart
 * mid-day doesn't split one visitor into two. Rows older than a couple of
 * days are deleted on rotation — keeping them would let an operator with DB
 * access replay old salts against a known IP to re-identify visitors, which
 * is exactly the property the rotating salt exists to destroy.
 */
export const CREATE_VISITOR_SALTS_TABLE = `
CREATE TABLE IF NOT EXISTS visitor_salts (
  day TEXT PRIMARY KEY,
  salt TEXT NOT NULL,
  created_at INTEGER NOT NULL
)`;

export const CREATE_ANALYTICS_INDEXES: string[] = [
	"CREATE INDEX IF NOT EXISTS idx_events_created_at ON events (created_at)",
	"CREATE INDEX IF NOT EXISTS idx_events_site_created_at ON events (site, created_at)",
	"CREATE INDEX IF NOT EXISTS idx_events_site_name_created_at ON events (site, name, created_at)",
	"CREATE INDEX IF NOT EXISTS idx_events_session ON events (site, session_id)",
	"CREATE INDEX IF NOT EXISTS idx_events_visitor ON events (site, visitor_id)",
	"CREATE INDEX IF NOT EXISTS idx_rollups_site_bucket ON event_rollups (site, bucket)",
	"CREATE INDEX IF NOT EXISTS idx_visitor_hours_bucket ON visitor_hours (site, bucket)",
	"CREATE INDEX IF NOT EXISTS idx_sessions_site_started ON sessions (site, started_at)",
	"CREATE INDEX IF NOT EXISTS idx_sessions_last_seen ON sessions (site, last_seen_at)",
];

/** Dimension columns of `event_rollups`, in PRIMARY KEY order. */
export const ROLLUP_DIMENSIONS = [
	"name",
	"path",
	"referrer_host",
	"utm_source",
	"utm_medium",
	"utm_campaign",
	"country",
	"device",
	"browser",
	"os",
] as const;

export type RollupDimension = (typeof ROLLUP_DIMENSIONS)[number];
