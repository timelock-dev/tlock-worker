import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import type { Deps } from "../src/lib/api";
import { createDrandClient } from "../src/lib/drand";
import type { EventsDb } from "../src/lib/events";

/** A real quicknet beacon, so decryption tests run offline. */
export const BEACON = {
	round: 1000000,
	randomness: "b22aad4794f7451896f7a371aa46106fd84d919f3f569acd5b2fddf1d1440af3",
	signature: "83ad29e4c409f9470fc2ef02f90214df49e02b441a1a241a82d622d9f608ef98fd8b11a029f1bee9d9e83b45088abe72",
};

/** In-memory SQLite with the D1 surface used by the app and the real migration applied. */
export function sqliteDb(): EventsDb & { rows: () => Record<string, unknown>[] } {
	const db = new DatabaseSync(":memory:");
	db.exec(readFileSync(new URL("../migrations/0001_events.sql", import.meta.url), "utf8"));
	return {
		prepare: (sql) => ({
			bind: (...values) => ({
				run: async () => db.prepare(sql).run(...(values as never[])),
				all: async <T>() => ({ results: db.prepare(sql).all(...(values as never[])) as T[] }),
			}),
		}),
		rows: () => db.prepare("SELECT * FROM events ORDER BY id").all() as Record<string, unknown>[],
	};
}

export function fakeDrand({ down = false } = {}) {
	const calls: string[] = [];
	const fetch = (async (input: RequestInfo | URL) => {
		const url = String(input);
		calls.push(url);
		if (down) throw new TypeError("network down");
		if (url.endsWith(`/public/${BEACON.round}`)) return Response.json(BEACON);
		return new Response("not found", { status: 404 });
	}) as typeof globalThis.fetch;
	return { client: createDrandClient({ fetch, relays: ["https://relay-a.test", "https://relay-b.test"] }), calls };
}

export function makeDeps(overrides: Partial<Deps> & { drandDown?: boolean } = {}) {
	const db = sqliteDb();
	const pending: Promise<unknown>[] = [];
	const { client } = fakeDrand({ down: overrides.drandDown });
	const deps: Deps = {
		drand: client,
		db,
		waitUntil: (p) => pending.push(p),
		...overrides,
	};
	return { deps, db, settle: () => Promise.all(pending) };
}

export const post = (path: string, body: BodyInit, headers: Record<string, string> = {}) =>
	new Request(`https://timelock.dev${path}`, { method: "POST", body, headers });

export const postJson = (path: string, body: unknown, headers: Record<string, string> = {}) =>
	post(path, JSON.stringify(body), { "Content-Type": "application/json", ...headers });
