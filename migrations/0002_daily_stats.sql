-- Per-day rollup so /api/stats and the homepage read ~31 rows instead of every event in the last 30 days.
CREATE TABLE IF NOT EXISTS daily_stats (
	day INTEGER PRIMARY KEY,           -- floor(created_at / 86400000), UTC days since epoch
	encrypted INTEGER NOT NULL DEFAULT 0,
	decrypted INTEGER NOT NULL DEFAULT 0,
	lock_ms_sum INTEGER NOT NULL DEFAULT 0 -- sum of MAX(unlock_at - created_at, 0) over encryptions
);

INSERT OR REPLACE INTO daily_stats (day, encrypted, decrypted, lock_ms_sum)
SELECT
	created_at / 86400000,
	SUM(type = 'encrypt'),
	SUM(type = 'decrypt'),
	COALESCE(SUM(CASE WHEN type = 'encrypt' THEN MAX(unlock_at - created_at, 0) END), 0)
FROM events
GROUP BY created_at / 86400000;
