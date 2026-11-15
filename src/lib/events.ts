export type EventType = "encrypt" | "decrypt";
export type EventSource = "web" | "api";

export interface FeedEvent {
	id: number;
	type: EventType;
	source: EventSource;
	createdAt: string;
	round: number;
	unlockAt: string;
}

interface Row {
	id: number;
	type: EventType;
	source: EventSource;
	created_at: number;
	round: number;
	unlock_at: number;
}

/** The subset of D1Database used here, so tests can supply any SQLite-backed implementation. */
export interface EventsDb {
	prepare(sql: string): {
		bind(...values: unknown[]): {
			run(): Promise<unknown>;
			all<T>(): Promise<{ results: T[] }>;
		};
	};
}

const DAY_MS = 86400_000;

export async function recordEvent(
	db: EventsDb,
	e: { type: EventType; source: EventSource; round: number; unlockAt: number; createdAt?: number },
): Promise<void> {
	const createdAt = e.createdAt ?? Date.now();
	await db
		.prepare("INSERT INTO events (type, source, created_at, round, unlock_at) VALUES (?, ?, ?, ?, ?)")
		.bind(e.type, e.source, createdAt, e.round, e.unlockAt)
		.run();
	const encrypt = e.type === "encrypt" ? 1 : 0;
	await db
		.prepare(
			`INSERT INTO daily_stats (day, encrypted, decrypted, lock_ms_sum) VALUES (?, ?, ?, ?)
			ON CONFLICT (day) DO UPDATE SET
				encrypted = encrypted + excluded.encrypted,
				decrypted = decrypted + excluded.decrypted,
				lock_ms_sum = lock_ms_sum + excluded.lock_ms_sum`,
		)
		.bind(Math.floor(createdAt / DAY_MS), encrypt, 1 - encrypt, encrypt ? Math.max(e.unlockAt - createdAt, 0) : 0)
		.run();
}

export interface EventStats {
	days: number;
	encrypted: number;
	decrypted: number;
	/** Mean seconds between encrypting and the unlock time, over encryptions in the window; null when there are none. */
	averageLockSeconds: number | null;
}

export const STATS_DAYS = 30;

/** Reads the per-day rollup: at most `days + 1` rows, however busy the site is. The window is whole UTC days. */
export async function eventStats(db: EventsDb, now: number = Date.now(), days: number = STATS_DAYS): Promise<EventStats> {
	const { results } = await db
		.prepare(
			`SELECT
				COALESCE(SUM(encrypted), 0) AS encrypted,
				COALESCE(SUM(decrypted), 0) AS decrypted,
				COALESCE(SUM(lock_ms_sum), 0) AS lock_ms_sum
			FROM daily_stats WHERE day >= ?`,
		)
		.bind(Math.floor(now / DAY_MS) - days)
		.all<{ encrypted: number; decrypted: number; lock_ms_sum: number }>();
	const row = results[0] ?? { encrypted: 0, decrypted: 0, lock_ms_sum: 0 };
	const encrypted = Number(row.encrypted);
	return {
		days,
		encrypted,
		decrypted: Number(row.decrypted),
		averageLockSeconds: encrypted === 0 ? null : Math.round(Number(row.lock_ms_sum) / encrypted / 1000),
	};
}

export async function listEvents(db: EventsDb, { limit = 20, before }: { limit?: number; before?: number } = {}): Promise<FeedEvent[]> {
	const { results } = await db
		.prepare(
			"SELECT id, type, source, created_at, round, unlock_at FROM events WHERE id < ? ORDER BY id DESC LIMIT ?",
		)
		.bind(before ?? Number.MAX_SAFE_INTEGER, limit)
		.all<Row>();
	return results.map((r) => ({
		id: r.id,
		type: r.type,
		source: r.source,
		createdAt: new Date(r.created_at).toISOString(),
		round: r.round,
		unlockAt: new Date(r.unlock_at).toISOString(),
	}));
}
