// cspell:words héllo
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { apiDecrypt, apiEncrypt, getEvents, getStats, legacyDecrypt, legacyEncrypt, LIMITS, postEvent, resolveRound } from "../src/lib/api";
import { QUICKNET, roundForTime, roundTime } from "../src/lib/drand";
import { recordEvent } from "../src/lib/events";
import { CORS_HEADERS, isApiPath } from "../src/lib/http";
import { formatUtc } from "../src/lib/time";
import { inspectCiphertext } from "../src/lib/tlock";
import { BEACON, fakeDrand, makeDeps, post, postJson } from "./helpers";

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url));
const AFTER = roundTime(BEACON.round) + 60_000;
const BEFORE = roundTime(BEACON.round) - 60_000;

async function encryptToFixtureRound(deps: ReturnType<typeof makeDeps>["deps"], plaintext = "hello, future") {
	const res = await apiEncrypt(postJson("/api/encrypt", { plaintext, round: BEACON.round }), deps);
	expect(res.status).toBe(200);
	return (await res.json()) as { ciphertext: string; round: number; unlockAt: string; unlockAtUnix: number; chainHash: string };
}

describe("POST /api/encrypt", () => {
	it("encrypts to an exact round and records an api event", async () => {
		const { deps, db, settle } = makeDeps();
		const body = await encryptToFixtureRound(deps);
		expect(body.ciphertext).toMatch(/^-----BEGIN AGE ENCRYPTED FILE-----\n[\s\S]+\n-----END AGE ENCRYPTED FILE-----\n$/);
		expect(body).toMatchObject({ round: BEACON.round, chainHash: QUICKNET.hash, unlockAtUnix: roundTime(BEACON.round) / 1000 });
		expect(inspectCiphertext(body.ciphertext)).toMatchObject({ round: BEACON.round, chainHash: QUICKNET.hash });
		await settle();
		expect(db.rows()).toEqual([expect.objectContaining({ type: "encrypt", source: "api", round: BEACON.round, unlock_at: roundTime(BEACON.round) })]);
	});

	it("resolves durations, rounding up to the next round", async () => {
		const now = Date.UTC(2026, 9, 22, 0, 0, 1);
		const { deps } = makeDeps({ now: () => now });
		const res = await apiEncrypt(postJson("/api/encrypt", { plaintext: "x", duration: "5m" }), deps);
		const body = (await res.json()) as { round: number; unlockAt: string };
		expect(body.round).toBe(roundForTime(now + 300_000));
		const unlock = Date.parse(body.unlockAt);
		expect(unlock).toBeGreaterThanOrEqual(now + 300_000);
		expect(unlock - (now + 300_000)).toBeLessThan(QUICKNET.period * 1000);
	});

	it("accepts unlockAt as ISO 8601 or unix seconds", async () => {
		const now = Date.UTC(2026, 9, 22);
		const { deps } = makeDeps({ now: () => now });
		for (const unlockAt of ["2030-01-01T00:00:00Z", 1893456000]) {
			const res = await apiEncrypt(postJson("/api/encrypt", { plaintext: "x", unlockAt }), deps);
			expect(((await res.json()) as { round: number }).round).toBe(roundForTime(Date.UTC(2030, 0, 1)));
		}
	});

	it("accepts base64 plaintext without a JSON content type", async () => {
		const { deps } = makeDeps();
		const res = await apiEncrypt(post("/api/encrypt", JSON.stringify({ plaintext: "AAEC/w==", encoding: "base64", round: BEACON.round })), deps);
		expect(res.status).toBe(200);
	});

	it.each([
		["invalid JSON", "{nope", 400, "invalid_json"],
		["array body", "[]", 400, "invalid_json"],
		["missing plaintext", { round: 5 }, 400, "invalid_request"],
		["empty plaintext", { plaintext: "", round: 5 }, 400, "invalid_request"],
		["no unlock", { plaintext: "x" }, 400, "invalid_request"],
		["two unlocks", { plaintext: "x", round: 5, duration: 60 }, 400, "invalid_request"],
		["bad duration", { plaintext: "x", duration: "soon" }, 400, "invalid_request"],
		["past unlockAt", { plaintext: "x", unlockAt: "2020-01-01T00:00:00Z" }, 400, "invalid_request"],
		["unlockAt without zone", { plaintext: "x", unlockAt: "2030-01-01T00:00:00" }, 400, "invalid_request"],
		["too far ahead", { plaintext: "x", duration: "101y" }, 400, "invalid_request"],
		["fractional round", { plaintext: "x", round: 1.5 }, 400, "invalid_request"],
		["bad encoding", { plaintext: "x", round: 5, encoding: "hex" }, 400, "invalid_request"],
		["bad base64", { plaintext: "@@@", round: 5, encoding: "base64" }, 400, "invalid_request"],
		["plaintext too large", { plaintext: "a".repeat(LIMITS.plaintextBytes + 1), round: 5 }, 413, "payload_too_large"],
	])("rejects %s", async (_, body, status, code) => {
		const { deps, db, settle } = makeDeps();
		const res = await apiEncrypt(post("/api/encrypt", typeof body === "string" ? body : JSON.stringify(body)), deps);
		expect(res.status).toBe(status);
		expect(res.headers.get("Content-Type")).toContain("application/json");
		expect(((await res.json()) as { error: { code: string } }).error.code).toBe(code);
		await settle();
		expect(db.rows()).toHaveLength(0);
	});

	it("rejects oversized bodies from Content-Length before reading", async () => {
		const { deps } = makeDeps();
		const req = post("/api/encrypt", "{}", { "Content-Length": String(LIMITS.jsonBodyBytes + 1) });
		expect((await apiEncrypt(req, deps)).status).toBe(413);
	});

	it("keeps working when the feed database fails", async () => {
		const { deps, settle } = makeDeps();
		const broken = { prepare: () => ({ bind: () => ({ run: () => Promise.reject(new Error("D1 down")), all: () => Promise.reject(new Error("D1 down")) }) }) };
		const res = await apiEncrypt(postJson("/api/encrypt", { plaintext: "x", round: 5 }), { ...deps, db: broken });
		expect(res.status).toBe(200);
		await settle();
	});
});

describe("POST /api/decrypt", () => {
	it("round-trips text and records a decrypt event", async () => {
		const { deps, db, settle } = makeDeps({ now: () => AFTER });
		const { ciphertext } = await encryptToFixtureRound(deps, "héllo, future ⏳");
		const res = await apiDecrypt(postJson("/api/decrypt", { ciphertext }), deps);
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({
			plaintext: "héllo, future ⏳",
			encoding: "utf8",
			round: BEACON.round,
			unlockAt: new Date(roundTime(BEACON.round)).toISOString(),
			unlockAtUnix: roundTime(BEACON.round) / 1000,
		});
		await settle();
		expect(db.rows().map((r) => r.type)).toEqual(["encrypt", "decrypt"]);
	});

	it("returns binary plaintext as base64", async () => {
		const { deps } = makeDeps({ now: () => AFTER });
		const res = await apiEncrypt(postJson("/api/encrypt", { plaintext: "AAEC/w==", encoding: "base64", round: BEACON.round }), deps);
		const { ciphertext } = (await res.json()) as { ciphertext: string };
		const out = (await (await apiDecrypt(postJson("/api/decrypt", { ciphertext }), deps)).json()) as { plaintext: string; encoding: string };
		expect(out).toMatchObject({ plaintext: "AAEC/w==", encoding: "base64" });
	});

	it("can force base64 output", async () => {
		const { deps } = makeDeps({ now: () => AFTER });
		const { ciphertext } = await encryptToFixtureRound(deps, "hi");
		const out = (await (await apiDecrypt(postJson("/api/decrypt", { ciphertext, encoding: "base64" }), deps)).json()) as { plaintext: string };
		expect(out.plaintext).toBe("aGk=");
	});

	it("decrypts ciphertext made by the original Rust worker's crate (tlock_age 0.0.5)", async () => {
		const { deps } = makeDeps({ now: () => AFTER });
		const res = await apiDecrypt(postJson("/api/decrypt", { ciphertext: fixture("rust-tlock-age-0.0.5.age").toString("utf8") }), deps);
		expect(((await res.json()) as { plaintext: string }).plaintext).toBe("encrypted by the original Rust worker crate (tlock_age 0.0.5)");
	});

	it("answers 425 too_early without contacting drand", async () => {
		const drand = fakeDrand();
		const { deps } = makeDeps({ now: () => BEFORE, drand: drand.client });
		const { ciphertext } = await encryptToFixtureRound(deps);
		const res = await apiDecrypt(postJson("/api/decrypt", { ciphertext }), deps);
		expect(res.status).toBe(425);
		expect(await res.json()).toEqual({
			error: {
				code: "too_early",
				message: expect.stringContaining(`round ${BEACON.round}`),
				round: BEACON.round,
				unlockAt: new Date(roundTime(BEACON.round)).toISOString(),
				unlockAtUnix: roundTime(BEACON.round) / 1000,
			},
		});
		expect(drand.calls).toHaveLength(0);
	});

	it("answers 502 when every drand relay is down", async () => {
		const { deps } = makeDeps({ now: () => AFTER, drandDown: true });
		const { ciphertext } = await encryptToFixtureRound(deps);
		const res = await apiDecrypt(postJson("/api/decrypt", { ciphertext }), deps);
		expect(res.status).toBe(502);
		expect(((await res.json()) as { error: { code: string } }).error.code).toBe("drand_unavailable");
	});

	it("falls back to the next relay", async () => {
		const calls: string[] = [];
		const { createDrandClient } = await import("../src/lib/drand");
		const client = createDrandClient({
			relays: ["https://down.test", "https://up.test"],
			fetch: (async (url: string) => {
				calls.push(url);
				if (url.startsWith("https://down.test")) return new Response("oops", { status: 500 });
				return Response.json(BEACON);
			}) as typeof fetch,
		});
		const { deps } = makeDeps({ now: () => AFTER, drand: client });
		const { ciphertext } = await encryptToFixtureRound(deps);
		expect((await apiDecrypt(postJson("/api/decrypt", { ciphertext }), deps)).status).toBe(200);
		expect(calls.map((u) => new URL(u).host)).toEqual(["down.test", "up.test"]);
	});

	it("rejects a beacon with a forged signature as a drand failure", async () => {
		const { createDrandClient } = await import("../src/lib/drand");
		const forged = { ...BEACON, signature: BEACON.signature.replace(/^83/, "84") };
		const client = createDrandClient({ relays: ["https://evil.test"], fetch: (async () => Response.json(forged)) as unknown as typeof fetch });
		const { deps } = makeDeps({ now: () => AFTER, drand: client });
		const { ciphertext } = await encryptToFixtureRound(deps);
		const res = await apiDecrypt(postJson("/api/decrypt", { ciphertext }), deps);
		expect(res.status).toBe(502);
		expect(((await res.json()) as { error: { code: string } }).error.code).toBe("drand_unavailable");
	});

	it.each([
		["missing ciphertext", {}, 400, "invalid_request"],
		["not age", { ciphertext: "hello" }, 422, "invalid_ciphertext"],
		["truncated armor", { ciphertext: "-----BEGIN AGE ENCRYPTED FILE-----\nYWdl" }, 422, "invalid_ciphertext"],
	])("rejects %s", async (_, body, status, code) => {
		const { deps } = makeDeps({ now: () => AFTER });
		const res = await apiDecrypt(postJson("/api/decrypt", body), deps);
		expect(res.status).toBe(status);
		expect(((await res.json()) as { error: { code: string } }).error.code).toBe(code);
	});

	it("rejects ciphertext for another drand chain", async () => {
		const { deps } = makeDeps({ now: () => AFTER });
		const { ciphertext } = await encryptToFixtureRound(deps);
		const header = Buffer.from(ciphertext.split("\n").slice(1, -2).join(""), "base64").toString("binary");
		const swapped = header.replace(QUICKNET.hash, "dbd506d6ef76e5f386f41c651dcb808c5bcbd75471cc4eafa3f4df7ad4e4c493");
		const armored = `-----BEGIN AGE ENCRYPTED FILE-----\n${Buffer.from(swapped, "binary").toString("base64").replace(/.{64}/g, "$&\n")}\n-----END AGE ENCRYPTED FILE-----\n`;
		const res = await apiDecrypt(postJson("/api/decrypt", { ciphertext: armored }), deps);
		expect(res.status).toBe(422);
		expect(((await res.json()) as { error: { code: string } }).error.code).toBe("unsupported_chain");
	});
});

describe("plain notes outside the armored block", () => {
	const UNLOCK = roundTime(BEACON.round);

	it("adds no notes unless asked, so existing API clients see no change", async () => {
		const { deps } = makeDeps();
		const { ciphertext } = await encryptToFixtureRound(deps);
		expect(ciphertext.startsWith("-----BEGIN AGE ENCRYPTED FILE-----\n")).toBe(true);
	});

	it("adds instructions and the unlock time above the block when asked", async () => {
		const { deps } = makeDeps();
		const res = await apiEncrypt(
			postJson("/api/encrypt", { plaintext: "x", round: BEACON.round, includeInstructions: true, includeUnlockTime: true, timeZone: "America/New_York" }),
			deps,
		);
		const { ciphertext } = (await res.json()) as { ciphertext: string };
		const [first, second, blank, begin] = ciphertext.split("\n");
		expect(first).toBe("Unlock at https://timelock.dev");
		expect(second).toBe(`Unlocks: Wed, Sep 27, 2023 4:29 AM EDT (${formatUtc(UNLOCK)})`);
		expect(blank).toBe("");
		expect(begin).toBe("-----BEGIN AGE ENCRYPTED FILE-----");
		expect(inspectCiphertext(ciphertext)).toMatchObject({ round: BEACON.round, notes: [first, second] });
	});

	it("writes the unlock time in UTC when no time zone is given", async () => {
		const { deps } = makeDeps();
		const res = await apiEncrypt(postJson("/api/encrypt", { plaintext: "x", round: BEACON.round, includeUnlockTime: true }), deps);
		const { ciphertext } = (await res.json()) as { ciphertext: string };
		expect(ciphertext.split("\n")[0]).toBe(`Unlocks: Wed, Sep 27, 2023 8:29 AM UTC (${formatUtc(UNLOCK)})`);
	});

	it.each([
		["a non-boolean flag", { includeInstructions: "yes" }],
		["an unknown time zone", { includeUnlockTime: true, timeZone: "Mars/Olympus" }],
		["a non-string time zone", { timeZone: 5 }],
	])("rejects %s", async (_, extra) => {
		const { deps, db, settle } = makeDeps();
		const res = await apiEncrypt(postJson("/api/encrypt", { plaintext: "x", round: BEACON.round, ...extra }), deps);
		expect(res.status).toBe(400);
		await settle();
		expect(db.rows()).toHaveLength(0);
	});

	it("POST /api/decrypt reads the block and ignores notes around it", async () => {
		const { deps } = makeDeps({ now: () => AFTER });
		const res = await apiEncrypt(postJson("/api/encrypt", { plaintext: "said it first", round: BEACON.round, includeInstructions: true, includeUnlockTime: true }), deps);
		const { ciphertext } = (await res.json()) as { ciphertext: string };
		const pasted = `${ciphertext}\nPosted by @alan\n`;
		const out = (await (await apiDecrypt(postJson("/api/decrypt", { ciphertext: pasted }), deps)).json()) as { plaintext: string };
		expect(out.plaintext).toBe("said it first");
	});

	it("POST /decrypt (original endpoint) accepts notes too", async () => {
		const { deps } = makeDeps({ now: () => AFTER });
		const armored = await (await legacyEncrypt(post(`/encrypt/${BEACON.round}`, "legacy"), String(BEACON.round), deps)).text();
		const res = await legacyDecrypt(post("/decrypt", `Unlock at https://timelock.dev\r\nUnlocks: whenever\r\n\r\n${armored.replace(/\n/g, "\r\n")}`), deps);
		expect(res.status).toBe(200);
		expect(await res.text()).toBe("legacy");
	});

	it("rejects text with two encrypted blocks", async () => {
		const { deps } = makeDeps({ now: () => AFTER });
		const { ciphertext } = await encryptToFixtureRound(deps);
		const res = await apiDecrypt(postJson("/api/decrypt", { ciphertext: `${ciphertext}\n${ciphertext}` }), deps);
		expect(res.status).toBe(422);
		expect(((await res.json()) as { error: { message: string } }).error.message).toMatch(/more than one encrypted block/);
	});
});

describe("legacy endpoints (original Rust worker API)", () => {
	it("POST /encrypt/:round returns armored age as octet-stream, POST /decrypt returns raw bytes", async () => {
		const { deps } = makeDeps({ now: () => AFTER });
		const bytes = new Uint8Array(256).map((_, i) => i);
		const enc = await legacyEncrypt(post(`/encrypt/${BEACON.round}`, bytes), String(BEACON.round), deps);
		expect(enc.status).toBe(200);
		expect(enc.headers.get("Content-Type")).toBe("application/octet-stream");
		const armored = await enc.text();
		expect(armored.startsWith("-----BEGIN AGE ENCRYPTED FILE-----\n")).toBe(true);
		const dec = await legacyDecrypt(post("/decrypt", armored), deps);
		expect(dec.status).toBe(200);
		expect(new Uint8Array(await dec.arrayBuffer())).toEqual(bytes);
	});

	it("POST /decrypt accepts binary (non-armored) age from dee", async () => {
		const { deps } = makeDeps({ now: () => AFTER });
		const res = await legacyDecrypt(post("/decrypt", fixture("dee-binary.age")), deps);
		expect(await res.text()).toBe("binary age from dee");
	});

	it("POST /decrypt accepts output of the original Rust worker", async () => {
		const { deps } = makeDeps({ now: () => AFTER });
		const res = await legacyDecrypt(post("/decrypt", fixture("rust-tlock-age-0.0.5.age")), deps);
		expect(await res.text()).toBe("encrypted by the original Rust worker crate (tlock_age 0.0.5)");
	});

	it.each(["abc", "-1", "0", "1.5", "", "99999999999999999999"])("POST /encrypt/%s → 400 round invalid", async (round) => {
		const { deps } = makeDeps();
		const res = await legacyEncrypt(post(`/encrypt/${round}`, "x"), round, deps);
		expect(res.status).toBe(400);
		expect(await res.text()).toBe("round invalid\n");
	});

	it("POST /decrypt reports too-early and garbage as plain text", async () => {
		const { deps } = makeDeps({ now: () => BEFORE });
		const armored = await (await legacyEncrypt(post(`/encrypt/${BEACON.round}`, "x"), String(BEACON.round), deps)).text();
		const early = await legacyDecrypt(post("/decrypt", armored), deps);
		expect(early.status).toBe(425);
		expect(early.headers.get("Content-Type")).toContain("text/plain");
		expect((await legacyDecrypt(post("/decrypt", "garbage"), deps)).status).toBe(422);
	});

	it("enforces the upload limit", async () => {
		const { deps } = makeDeps();
		const res = await legacyEncrypt(post("/encrypt/5", new Uint8Array(LIMITS.legacyBodyBytes + 1)), "5", deps);
		expect(res.status).toBe(413);
	});
});

describe("feed: /api/events", () => {
	const origin = { Origin: "https://timelock.dev" };

	it("records same-origin browser events", async () => {
		const now = AFTER;
		const { deps, db } = makeDeps({ now: () => now });
		expect((await postEvent(postJson("/api/events", { type: "encrypt", round: BEACON.round + 100 }, origin), deps)).status).toBe(204);
		expect((await postEvent(postJson("/api/events", { type: "decrypt", round: BEACON.round }, origin), deps)).status).toBe(204);
		expect(db.rows()).toEqual([
			{ id: 1, type: "encrypt", source: "web", created_at: now, round: BEACON.round + 100, unlock_at: roundTime(BEACON.round + 100) },
			{ id: 2, type: "decrypt", source: "web", created_at: now, round: BEACON.round, unlock_at: roundTime(BEACON.round) },
		]);
	});

	it.each([
		["cross-origin", { type: "encrypt", round: 5 }, { Origin: "https://evil.example" }, 403],
		["no origin", { type: "encrypt", round: 5 }, {}, 403],
		["unknown type", { type: "peek", round: 5 }, origin, 400],
		["decrypt of a future round", { type: "decrypt", round: BEACON.round + 1000 }, origin, 400],
		["absurd round", { type: "encrypt", round: 1e15 }, origin, 400],
		["extra payload", { type: "encrypt", round: 5, plaintext: "x".repeat(2000) }, origin, 413],
	])("rejects %s", async (_, body, headers, status) => {
		const { deps, db } = makeDeps({ now: () => AFTER });
		expect((await postEvent(postJson("/api/events", body, headers), deps)).status).toBe(status);
		expect(db.rows()).toHaveLength(0);
	});

	it("lists newest first with pagination and no sensitive fields", async () => {
		const { db } = makeDeps();
		for (let i = 0; i < 5; i++) await recordEvent(db, { type: i % 2 ? "decrypt" : "encrypt", source: "api", round: 10 + i, unlockAt: roundTime(10 + i), createdAt: 1_000 * i });
		const page1 = await getEvents(new URL("https://timelock.dev/api/events?limit=2"), { db });
		expect(page1.headers.get("Cache-Control")).toBe("public, max-age=5");
		const body1 = (await page1.json()) as { events: Record<string, unknown>[]; nextBefore: number };
		expect(body1.events.map((e) => e.id)).toEqual([5, 4]);
		expect(Object.keys(body1.events[0]).sort()).toEqual(["createdAt", "id", "round", "source", "type", "unlockAt"]);
		expect(body1.events[0]).toMatchObject({ type: "encrypt", createdAt: new Date(4000).toISOString() });
		const body2 = (await (await getEvents(new URL(`https://timelock.dev/api/events?limit=2&before=${body1.nextBefore}`), { db })).json()) as { events: { id: number }[]; nextBefore: number };
		expect(body2.events.map((e) => e.id)).toEqual([3, 2]);
		const body3 = (await (await getEvents(new URL(`https://timelock.dev/api/events?limit=2&before=${body2.nextBefore}`), { db })).json()) as { events: { id: number }[]; nextBefore: number | null };
		expect(body3).toMatchObject({ events: [{ id: 1 }], nextBefore: null });
	});

	it.each(["limit=0", "limit=101", "limit=abc", "before=-1", "before=x"])("rejects ?%s", async (q) => {
		const { db } = makeDeps();
		expect((await getEvents(new URL(`https://timelock.dev/api/events?${q}`), { db })).status).toBe(400);
	});

	it("answers 503 when D1 isn't bound", async () => {
		expect((await getEvents(new URL("https://timelock.dev/api/events"), {})).status).toBe(503);
	});
});

describe("stats: /api/stats", () => {
	const DAY = 86400_000;
	const now = Date.UTC(2026, 9, 22, 12);

	it("counts the last 30 days and averages lock time over encryptions", async () => {
		const { db } = makeDeps();
		const add = (type: "encrypt" | "decrypt", createdAt: number, lockMs: number) =>
			recordEvent(db, { type, source: "web", round: 1, unlockAt: createdAt + lockMs, createdAt });
		await add("encrypt", now - 1000, 2 * 3600_000);
		await add("encrypt", now - 5 * DAY, 4 * 3600_000);
		await add("encrypt", now - 2 * DAY, -60_000); // past round: counts as a zero-length lock
		await add("decrypt", now - DAY, -3600_000);
		await add("encrypt", now - 31 * DAY, 1000 * DAY); // outside the window
		const res = await getStats({ db, now: () => now });
		expect(res.headers.get("Cache-Control")).toBe("public, max-age=5");
		expect(await res.json()).toEqual({ days: 30, encrypted: 3, decrypted: 1, averageLockSeconds: 2 * 3600 });
	});

	it("returns zeros and a null average with no events", async () => {
		const { db } = makeDeps();
		expect(await (await getStats({ db, now: () => now })).json()).toEqual({ days: 30, encrypted: 0, decrypted: 0, averageLockSeconds: null });
	});

	it("answers 503 when D1 isn't bound", async () => {
		expect((await getStats({})).status).toBe(503);
	});
});

describe("routing helpers", () => {
	it("applies CORS only to API paths", () => {
		expect(["/api/encrypt", "/api/events", "/encrypt/123", "/decrypt"].every(isApiPath)).toBe(true);
		expect(["/", "/docs", "/feed", "/decrypted", "/how-it-works"].some(isApiPath)).toBe(false);
		expect(CORS_HEADERS["Access-Control-Allow-Origin"]).toBe("*");
		expect(CORS_HEADERS).not.toHaveProperty("Access-Control-Allow-Credentials");
	});

	it("resolveRound accepts past rounds only when given explicitly", () => {
		const now = AFTER;
		expect(resolveRound({ round: 1 }, now)).toBe(1);
		expect(() => resolveRound({ unlockAt: (now - 1000) / 1000 }, now)).toThrow(/future/);
	});
});
