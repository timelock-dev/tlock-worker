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

export async function recordEvent(
	db: EventsDb,
	e: { type: EventType; source: EventSource; round: number; unlockAt: number; createdAt?: number },
): Promise<void> {
	await db
		.prepare("INSERT INTO events (type, source, created_at, round, unlock_at) VALUES (?, ?, ?, ?, ?)")
		.bind(e.type, e.source, e.createdAt ?? Date.now(), e.round, e.unlockAt)
		.run();
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
