-- Hosted messages behind unlisted /m/<id> links. Only the armored ciphertext block is stored: never plaintext,
-- never the plain notes around a block, no IP address or user agent. Rows are only ever read by primary key,
-- so there is no way to list or search them.
CREATE TABLE IF NOT EXISTS messages (
	id TEXT PRIMARY KEY,                -- random UUID v4, the only way to find the row
	ciphertext TEXT NOT NULL,           -- armored age block, exactly as hashed
	sha256 TEXT NOT NULL,               -- hex SHA-256 of ciphertext
	round INTEGER NOT NULL,             -- drand quicknet round it is locked to
	unlock_at INTEGER NOT NULL,         -- unix ms, derived from round
	created_at INTEGER NOT NULL,        -- unix ms, server clock: when we received it
	source TEXT NOT NULL CHECK (source IN ('web', 'api')),
	opened_at INTEGER,                  -- unix ms, first time a browser reported decrypting it
	opens INTEGER NOT NULL DEFAULT 0    -- browser-reported decryptions (unverified)
);

-- Per-day count of hosted messages, for the daily cap.
ALTER TABLE daily_stats ADD COLUMN hosted INTEGER NOT NULL DEFAULT 0;
