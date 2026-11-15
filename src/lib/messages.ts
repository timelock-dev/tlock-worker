import { recordEvent, type EventsDb, type EventSource } from "./events";

/** Lowercase UUID v4, as produced by crypto.randomUUID(). */
export const MESSAGE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const DAY_MS = 86400_000;

export interface StoredMessage {
	id: string;
	/** Armored age block only. Never plaintext, never notes. */
	ciphertext: string;
	sha256: string;
	round: number;
	unlockAt: number;
	createdAt: number;
	openedAt: number | null;
}

interface Row {
	id: string;
	ciphertext: string;
	sha256: string;
	round: number;
	unlock_at: number;
	created_at: number;
	opened_at: number | null;
}

export class DailyLimitError extends Error {}

export async function sha256Hex(text: string): Promise<string> {
	const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
	return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Stores an armored block under a new random id. The caller has already validated `ciphertext`.
 * Website uploads also count as the encryption event for recent activity (`recordEncrypt`).
 */
export async function createMessage(
	db: EventsDb,
	m: { ciphertext: string; round: number; unlockAt: number; source: EventSource; createdAt: number; dailyLimit: number; recordEncrypt: boolean },
): Promise<StoredMessage> {
	const day = Math.floor(m.createdAt / DAY_MS);
	const { results } = await db.prepare("SELECT hosted FROM daily_stats WHERE day = ?").bind(day).all<{ hosted: number }>();
	if (Number(results[0]?.hosted ?? 0) >= m.dailyLimit) throw new DailyLimitError();

	const id = crypto.randomUUID();
	const sha256 = await sha256Hex(m.ciphertext);
	await db
		.prepare("INSERT INTO messages (id, ciphertext, sha256, round, unlock_at, created_at, source) VALUES (?, ?, ?, ?, ?, ?, ?)")
		.bind(id, m.ciphertext, sha256, m.round, m.unlockAt, m.createdAt, m.source)
		.run();
	await db
		.prepare("INSERT INTO daily_stats (day, hosted) VALUES (?, 1) ON CONFLICT (day) DO UPDATE SET hosted = hosted + 1")
		.bind(day)
		.run();
	if (m.recordEncrypt) await recordEvent(db, { type: "encrypt", source: m.source, round: m.round, unlockAt: m.unlockAt, createdAt: m.createdAt });
	return { id, ciphertext: m.ciphertext, sha256, round: m.round, unlockAt: m.unlockAt, createdAt: m.createdAt, openedAt: null };
}

/** One row by primary key. There is deliberately no query that lists messages. */
export async function getMessage(db: EventsDb, id: string): Promise<StoredMessage | null> {
	if (!MESSAGE_ID.test(id)) return null;
	const { results } = await db
		.prepare("SELECT id, ciphertext, sha256, round, unlock_at, created_at, opened_at FROM messages WHERE id = ?")
		.bind(id)
		.all<Row>();
	const r = results[0];
	if (!r) return null;
	return { id: r.id, ciphertext: r.ciphertext, sha256: r.sha256, round: Number(r.round), unlockAt: Number(r.unlock_at), createdAt: Number(r.created_at), openedAt: r.opened_at === null ? null : Number(r.opened_at) };
}

/** A browser finished decrypting this message. Counts it and records the decrypt event for recent activity. */
export async function markOpened(db: EventsDb, message: StoredMessage, now: number): Promise<void> {
	await db.prepare("UPDATE messages SET opens = opens + 1, opened_at = COALESCE(opened_at, ?) WHERE id = ?").bind(now, message.id).run();
	await recordEvent(db, { type: "decrypt", source: "web", round: message.round, unlockAt: message.unlockAt, createdAt: now });
}
