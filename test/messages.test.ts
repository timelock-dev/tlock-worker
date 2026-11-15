import { describe, expect, it } from "vitest";
import { apiEncrypt, getMessageJson, getStats, LIMITS, postMessage, postMessageOpened } from "../src/lib/api";
import { roundTime } from "../src/lib/drand";
import { UNLISTED_HEADERS, isApiPath, isUnlistedPath } from "../src/lib/http";
import { MESSAGE_ID, getMessage, sha256Hex } from "../src/lib/messages";
import { BEACON, makeDeps, postJson } from "./helpers";

const BEFORE = roundTime(BEACON.round) - 60_000;
const AFTER = roundTime(BEACON.round) + 60_000;
const origin = { Origin: "https://timelock.dev" };
const SECRET = "the secret plan";

type Hosted = { id: string; url: string; round: number; unlockAt: string; createdAt: string; sha256: string; openedAt: string | null };

async function block(deps: ReturnType<typeof makeDeps>["deps"], round = BEACON.round) {
	const res = await apiEncrypt(postJson("/api/encrypt", { plaintext: SECRET, round }), deps);
	return ((await res.json()) as { ciphertext: string }).ciphertext;
}

async function host(deps: ReturnType<typeof makeDeps>["deps"], headers: Record<string, string> = origin) {
	const ciphertext = await block(deps);
	const res = await postMessage(postJson("/api/messages", { ciphertext }, headers), deps);
	expect(res.status).toBe(201);
	return { ciphertext, body: (await res.json()) as Hosted };
}

describe("POST /api/messages", () => {
	it("stores the block under a random id and returns the link", async () => {
		const { deps, db } = makeDeps({ now: () => BEFORE });
		const { ciphertext, body } = await host(deps);
		expect(body.id).toMatch(MESSAGE_ID);
		expect(body.url).toBe(`https://timelock.dev/m/${body.id}`);
		expect(body.round).toBe(BEACON.round);
		expect(body.unlockAt).toBe(new Date(roundTime(BEACON.round)).toISOString());
		expect(body.createdAt).toBe(new Date(BEFORE).toISOString());
		expect(body.sha256).toBe(await sha256Hex(ciphertext));
		expect(body.openedAt).toBeNull();
		expect(db.messages()).toEqual([
			{ id: body.id, ciphertext, sha256: body.sha256, round: BEACON.round, unlock_at: roundTime(BEACON.round), created_at: BEFORE, source: "web", opened_at: null, opens: 0 },
		]);
	});

	it("never stores plain text: notes around the block are dropped", async () => {
		const { deps, db } = makeDeps({ now: () => BEFORE });
		const ciphertext = await block(deps);
		const res = await postMessage(postJson("/api/messages", { ciphertext: `${SECRET}\nUnlock at https://timelock.dev\n\n${ciphertext}\n${SECRET}\n` }, origin), deps);
		expect(res.status).toBe(201);
		const stored = JSON.stringify(db.messages());
		expect(stored).not.toContain(SECRET);
		expect(stored).not.toContain("Unlock at");
		expect(db.messages()[0].ciphertext).toBe(ciphertext);
	});

	it("gives every upload its own unguessable id", async () => {
		const { deps } = makeDeps({ now: () => BEFORE });
		const ids = new Set<string>();
		for (let i = 0; i < 5; i++) ids.add((await host(deps)).body.id);
		expect(ids.size).toBe(5);
	});

	it("counts a website upload as the encrypt event, and an API upload as none", async () => {
		const { deps, db, settle } = makeDeps({ now: () => BEFORE });
		const ciphertext = await block(deps);
		await settle();
		expect(db.rows()).toHaveLength(1); // the /api/encrypt call above
		await postMessage(postJson("/api/messages", { ciphertext }), deps);
		expect(db.rows()).toHaveLength(1);
		await postMessage(postJson("/api/messages", { ciphertext }, origin), deps);
		expect(db.rows()).toHaveLength(2);
		expect(db.rows()[1].type).toBe("encrypt");
		expect(db.rows()[1].source).toBe("web");
		expect(db.messages().map((m) => m.source).sort()).toEqual(["api", "web"]);
		expect(((await (await getStats({ db, now: () => BEFORE })).json()) as { encrypted: number }).encrypted).toBe(2);
	});

	it("rejects anything that isn't a locked quicknet block", async () => {
		const { deps, db } = makeDeps({ now: () => BEFORE });
		const good = await block(deps);
		const cases: [unknown, number, string][] = [
			[{}, 400, "invalid_request"],
			[{ ciphertext: "   " }, 400, "invalid_request"],
			[{ ciphertext: "just some text" }, 422, "invalid_ciphertext"],
			[{ ciphertext: "-----BEGIN AGE ENCRYPTED FILE-----\nnot base64 <script>\n-----END AGE ENCRYPTED FILE-----\n" }, 422, "invalid_ciphertext"],
			[{ ciphertext: `-----BEGIN AGE ENCRYPTED FILE-----\n${btoa("hello world, this is not age")}\n-----END AGE ENCRYPTED FILE-----\n` }, 422, "invalid_ciphertext"],
			[{ ciphertext: `${good}${good}` }, 422, "invalid_ciphertext"],
		];
		for (const [body, status, code] of cases) {
			const res = await postMessage(postJson("/api/messages", body, origin), deps);
			expect(res.status).toBe(status);
			expect(((await res.json()) as { error: { code: string } }).error.code).toBe(code);
		}
		expect(db.messages()).toHaveLength(0);
	});

	it("rejects a block that has already unlocked", async () => {
		const { deps, db } = makeDeps({ now: () => BEFORE });
		const ciphertext = await block(deps);
		const late = { ...deps, now: () => AFTER };
		const res = await postMessage(postJson("/api/messages", { ciphertext }, origin), late);
		expect(res.status).toBe(400);
		expect(db.messages()).toHaveLength(0);
	});

	it("rejects blocks over the size limit", async () => {
		const { deps, db } = makeDeps({ now: () => BEFORE });
		const res = await apiEncrypt(postJson("/api/encrypt", { plaintext: "x".repeat(LIMITS.hostedCiphertextBytes), round: BEACON.round }), deps);
		const { ciphertext } = (await res.json()) as { ciphertext: string };
		expect((await postMessage(postJson("/api/messages", { ciphertext }, origin), deps)).status).toBe(413);
		expect(db.messages()).toHaveLength(0);
	});

	it("applies the per-IP rate limit before reading the body", async () => {
		const keys: string[] = [];
		const { deps, db } = makeDeps({ now: () => BEFORE, limiter: { limit: async ({ key }) => (keys.push(key), { success: keys.length <= 1 }) } });
		const ciphertext = await block(deps);
		const send = () => postMessage(postJson("/api/messages", { ciphertext }, { ...origin, "CF-Connecting-IP": "203.0.113.7" }), deps);
		expect((await send()).status).toBe(201);
		const res = await send();
		expect(res.status).toBe(429);
		expect(((await res.json()) as { error: { code: string } }).error.code).toBe("rate_limited");
		expect(keys).toEqual(["203.0.113.7", "203.0.113.7"]);
		expect(db.messages()).toHaveLength(1);
		expect(JSON.stringify(db.messages())).not.toContain("203.0.113.7");
	});

	it("stops at the daily cap and starts again the next UTC day", async () => {
		let now = Date.UTC(2023, 8, 20, 12); // a week before the fixture round unlocks
		const { deps, db } = makeDeps({ now: () => now });
		const ciphertext = await block(deps);
		const send = () => postMessage(postJson("/api/messages", { ciphertext }), deps);
		for (let i = 0; i < LIMITS.hostedPerDay; i++) expect((await send()).status).toBe(201);
		expect((await send()).status).toBe(429);
		expect(db.messages()).toHaveLength(LIMITS.hostedPerDay);
		now += 86400_000;
		expect((await send()).status).toBe(201);
	});

	it("answers 503 when D1 isn't bound", async () => {
		expect((await postMessage(postJson("/api/messages", { ciphertext: "x" }, origin), { ...makeDeps().deps, db: undefined })).status).toBe(503);
	});
});

describe("GET /api/messages/:id", () => {
	const url = new URL("https://timelock.dev/api/messages/x");

	it("returns the stored block before and after the unlock time", async () => {
		const { deps } = makeDeps({ now: () => BEFORE });
		const { ciphertext, body } = await host(deps);
		const res = await getMessageJson(url, body.id, deps);
		expect(res.status).toBe(200);
		const got = (await res.json()) as Hosted & { ciphertext: string; network: string };
		expect(got.ciphertext).toBe(ciphertext);
		expect(got.id).toBe(body.id);
		expect(got.url).toBe(body.url);
		expect(got.sha256).toBe(body.sha256);
		expect(got.network).toBe("quicknet");
	});

	it("answers 404 for unknown, malformed and injected ids, without listing anything", async () => {
		const { deps } = makeDeps({ now: () => BEFORE });
		const { body } = await host(deps);
		for (const id of [undefined, "", "1", "%", "' OR 1=1 --", body.id.toUpperCase(), body.id.slice(0, 35), `${body.id} `, "00000000-0000-4000-8000-000000000000"]) {
			const res = await getMessageJson(url, id, deps);
			expect(res.status).toBe(404);
			expect(await res.text()).not.toContain("BEGIN AGE");
		}
		expect(await getMessage(deps.db!, "%")).toBeNull();
	});
});

describe("POST /api/messages/:id/opened", () => {
	const opened = (id: string, headers: Record<string, string> = origin) => new Request(`https://timelock.dev/api/messages/${id}/opened`, { method: "POST", headers });

	it("records the first open, counts later ones and adds a decrypt event", async () => {
		let now = BEFORE;
		const { deps, db } = makeDeps({ now: () => now });
		const { body } = await host(deps);
		expect((await postMessageOpened(opened(body.id), body.id, deps)).status).toBe(425);
		expect(db.messages()[0].opens).toBe(0);

		now = AFTER;
		expect((await postMessageOpened(opened(body.id), body.id, deps)).status).toBe(204);
		now = AFTER + 5000;
		expect((await postMessageOpened(opened(body.id), body.id, deps)).status).toBe(204);
		expect(db.messages()[0].opened_at).toBe(AFTER);
		expect(db.messages()[0].opens).toBe(2);
		expect(db.rows().filter((r) => r.type === "decrypt")).toHaveLength(2);
		const got = (await (await getMessageJson(new URL("https://timelock.dev/x"), body.id, deps)).json()) as Hosted;
		expect(got.openedAt).toBe(new Date(AFTER).toISOString());
	});

	it("is same-origin only and 404s unknown ids", async () => {
		const { deps } = makeDeps({ now: () => AFTER });
		const id = "00000000-0000-4000-8000-000000000000";
		expect((await postMessageOpened(opened(id, {}), id, deps)).status).toBe(403);
		expect((await postMessageOpened(opened(id, { Origin: "https://evil.example" }), id, deps)).status).toBe(403);
		expect((await postMessageOpened(opened(id), id, deps)).status).toBe(404);
	});
});

describe("unlisted paths", () => {
	it("marks message pages and their API as noindex, no-referrer and uncacheable", () => {
		expect(["/m/abc", "/api/messages", "/api/messages/abc", "/api/messages/abc/opened"].every(isUnlistedPath)).toBe(true);
		expect(["/", "/m", "/faq", "/api/events", "/api/messages-list", "/how-it-works"].some(isUnlistedPath)).toBe(false);
		expect(UNLISTED_HEADERS["X-Robots-Tag"]).toContain("noindex");
		expect(UNLISTED_HEADERS["Referrer-Policy"]).toBe("no-referrer");
		expect(UNLISTED_HEADERS["Cache-Control"]).toBe("no-store");
		expect(isApiPath("/api/messages")).toBe(true);
	});
});
