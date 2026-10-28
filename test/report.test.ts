// cspell:words unstub
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function memoryStore() {
	const data = new Map<string, string>();
	return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), data };
}

describe("reportEventOnce", () => {
	const posts: unknown[] = [];

	beforeEach(() => {
		posts.length = 0;
		vi.resetModules();
		vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
			posts.push(JSON.parse(String(init.body)));
			return new Response(null, { status: 204 });
		});
		vi.stubGlobal("window", { dispatchEvent: () => true });
	});
	afterEach(() => vi.unstubAllGlobals());

	it("reports the same decrypted message once per tab, however many times Decrypt is clicked", async () => {
		const { reportEventOnce } = await import("../src/scripts/report");
		const store = memoryStore();
		expect(await reportEventOnce("decrypt", 7, "-----BEGIN AGE ENCRYPTED FILE-----\nAAA\n-----END AGE ENCRYPTED FILE-----\n", store)).toBe(true);
		expect(await reportEventOnce("decrypt", 7, "-----BEGIN AGE ENCRYPTED FILE-----\nAAA\n-----END AGE ENCRYPTED FILE-----\n", store)).toBe(false);
		expect(await reportEventOnce("decrypt", 7, "-----BEGIN AGE ENCRYPTED FILE-----\nBBB\n-----END AGE ENCRYPTED FILE-----\n", store)).toBe(true);
		expect(posts).toEqual([
			{ type: "decrypt", round: 7 },
			{ type: "decrypt", round: 7 },
		]);
	});

	it("remembers across a reload in the same tab and stores only hashes", async () => {
		const store = memoryStore();
		await (await import("../src/scripts/report")).reportEventOnce("decrypt", 7, "secret-looking block", store);
		vi.resetModules();
		expect(await (await import("../src/scripts/report")).reportEventOnce("decrypt", 7, "secret-looking block", store)).toBe(false);
		expect(posts).toHaveLength(1);
		const saved = store.data.get("timelock:reported")!;
		expect(saved).not.toContain("secret");
		expect(JSON.parse(saved)).toEqual([expect.stringMatching(/^[0-9a-f]{64}$/)]);
	});

	it("keeps encrypt and decrypt of the same text separate, and works without storage", async () => {
		const { reportEventOnce } = await import("../src/scripts/report");
		expect(await reportEventOnce("encrypt", 9, "block", null)).toBe(true);
		expect(await reportEventOnce("decrypt", 9, "block", null)).toBe(true);
		expect(await reportEventOnce("decrypt", 9, "block", null)).toBe(false);
		expect(posts).toHaveLength(2);
	});
});
