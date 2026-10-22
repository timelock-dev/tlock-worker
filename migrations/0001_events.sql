-- Public activity feed. Deliberately stores no plaintext, ciphertext, IP address or user agent.
CREATE TABLE IF NOT EXISTS events (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	type TEXT NOT NULL CHECK (type IN ('encrypt', 'decrypt')),
	source TEXT NOT NULL CHECK (source IN ('web', 'api')),
	created_at INTEGER NOT NULL, -- unix ms, server clock
	round INTEGER NOT NULL,      -- drand quicknet round the message is locked to
	unlock_at INTEGER NOT NULL   -- unix ms, derived from round
);

CREATE INDEX IF NOT EXISTS events_created_at ON events (created_at DESC);
