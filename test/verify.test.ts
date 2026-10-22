import { describe, expect, it } from "vitest";
import { QUICKNET, roundTime } from "../src/lib/drand";
import { checkRelay, verifyDrand } from "../src/lib/verify";
import { BEACON } from "./helpers";

const NOW = roundTime(BEACON.round) + 1000;
const OTHER_KEY = QUICKNET.public_key.replace(/^83/, "93");

type Relay = { info?: object; beacon?: object; down?: boolean; status?: number };

function fakeRelays(relays: Record<string, Relay>) {
	return (async (input: RequestInfo | URL) => {
		const url = new URL(String(input));
		const r = relays[url.origin];
		if (!r || r.down) throw new TypeError("network down");
		if (r.status) return new Response("nope", { status: r.status });
		if (url.pathname === `/${QUICKNET.hash}/info`) return Response.json(r.info ?? QUICKNET);
		if (url.pathname === `/${QUICKNET.hash}/public/latest`) return Response.json(r.beacon ?? BEACON);
		return new Response("not found", { status: 404 });
	}) as typeof fetch;
}

describe("checkRelay", () => {
	it("passes a relay serving the pinned chain and a genuine current beacon", async () => {
		const check = await checkRelay("https://a.test", { fetch: fakeRelays({ "https://a.test": {} }), now: NOW });
		expect(check).toMatchObject({ ok: true, chainHashOk: true, publicKeyOk: true, signatureOk: true, roundOk: true, round: BEACON.round });
		expect(check.error).toBeUndefined();
	});

	it("accepts a beacon up to two rounds behind the clock", async () => {
		const later = roundTime(BEACON.round + 2) + 1000;
		expect((await checkRelay("https://a.test", { fetch: fakeRelays({ "https://a.test": {} }), now: later })).ok).toBe(true);
		const tooLate = roundTime(BEACON.round + 3) + 1000;
		const stale = await checkRelay("https://a.test", { fetch: fakeRelays({ "https://a.test": {} }), now: tooLate });
		expect(stale).toMatchObject({ ok: false, roundOk: false, signatureOk: true });
		expect(stale.error).toMatch(/round is 1000000, expected about 1000003/);
	});

	it("rejects a forged signature", async () => {
		const forged = { ...BEACON, signature: BEACON.signature.replace(/.$/, (c) => (c === "0" ? "1" : "0")) };
		const check = await checkRelay("https://a.test", { fetch: fakeRelays({ "https://a.test": { beacon: forged } }), now: NOW });
		expect(check).toMatchObject({ ok: false, signatureOk: false, chainHashOk: true });
	});

	it("rejects a beacon for a different round than it claims", async () => {
		const swapped = { ...BEACON, round: BEACON.round + 1 };
		const check = await checkRelay("https://a.test", { fetch: fakeRelays({ "https://a.test": { beacon: swapped } }), now: roundTime(BEACON.round + 1) + 1000 });
		expect(check).toMatchObject({ ok: false, signatureOk: false, roundOk: true });
	});

	it("rejects chain info with another hash or public key, even if the beacon is valid", async () => {
		const wrongHash = await checkRelay("https://a.test", { fetch: fakeRelays({ "https://a.test": { info: { ...QUICKNET, hash: "00".repeat(32) } } }), now: NOW });
		expect(wrongHash).toMatchObject({ ok: false, chainHashOk: false, signatureOk: true });
		const wrongKey = await checkRelay("https://a.test", { fetch: fakeRelays({ "https://a.test": { info: { ...QUICKNET, public_key: OTHER_KEY } } }), now: NOW });
		expect(wrongKey).toMatchObject({ ok: false, publicKeyOk: false });
		expect(wrongKey.error).toMatch(/public key/);
	});

	it("reports unreachable relays and HTTP errors", async () => {
		expect((await checkRelay("https://a.test", { fetch: fakeRelays({ "https://a.test": { down: true } }), now: NOW })).error).toMatch(/unreachable/);
		expect((await checkRelay("https://a.test", { fetch: fakeRelays({ "https://a.test": { status: 503 } }), now: NOW })).error).toMatch(/HTTP 503/);
	});
});

describe("verifyDrand", () => {
	it("is verified when every relay passes", async () => {
		const v = await verifyDrand({ relays: ["https://a.test", "https://b.test"], fetch: fakeRelays({ "https://a.test": {}, "https://b.test": {} }), now: NOW });
		expect(v).toMatchObject({ status: "verified", round: BEACON.round, checkedAt: NOW });
		expect(v.relays.map((r) => r.relay)).toEqual(["https://a.test", "https://b.test"]);
	});

	it("warns when relays disagree or one is down, and fails when none pass", async () => {
		const mismatch = await verifyDrand({
			relays: ["https://a.test", "https://b.test"],
			fetch: fakeRelays({ "https://a.test": {}, "https://b.test": { info: { ...QUICKNET, public_key: OTHER_KEY } } }),
			now: NOW,
		});
		expect(mismatch).toMatchObject({ status: "warning", round: BEACON.round });
		const down = await verifyDrand({ relays: ["https://a.test", "https://b.test"], fetch: fakeRelays({}), now: NOW });
		expect(down).toMatchObject({ status: "failed", round: null });
	});
});
