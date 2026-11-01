/**
 * Cross-implementation round trips against Go tle (drand/tlock) and dee (drand-rs), over the live drand relays.
 * Skipped unless TLE_BIN and/or DEE_BIN point at the binaries (see .github/workflows/test.yml).
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { apiDecrypt, apiEncrypt, legacyDecrypt, legacyEncrypt, LIMITS } from "../src/lib/api";
import { createDrandClient, currentRound, QUICKNET } from "../src/lib/drand";
import { encrypt, extractArmor } from "../src/lib/tlock";
import { makeDeps, post, postJson } from "./helpers";

const TLE = process.env.TLE_BIN;
const DEE = process.env.DEE_BIN;
const RELAY = "https://api.drand.sh";
const deeEnv = { ...process.env, XDG_CONFIG_HOME: mkdtempSync(join(tmpdir(), "dee-")) };

type Tool = { name: string; decrypt: (input: Uint8Array) => Buffer; encrypt: (input: Uint8Array, round: number, armor: boolean) => Buffer };

function run(bin: string, args: string[], input: Uint8Array, env = process.env): Buffer {
	const res = spawnSync(bin, args, { input, env, maxBuffer: 16 * 1024 * 1024, timeout: 60_000 });
	if (res.status !== 0) throw new Error(`${bin} ${args.join(" ")} exited ${res.status}: ${res.stderr.toString()}`);
	return res.stdout;
}

const tools: Tool[] = [];
if (TLE) {
	const net = ["-n", RELAY, "-c", QUICKNET.hash];
	tools.push({
		name: "tle",
		decrypt: (input) => run(TLE, ["-d", ...net], input),
		encrypt: (input, round, armor) => run(TLE, ["-e", "-f", ...net, "-r", String(round), ...(armor ? ["-a"] : [])], input),
	});
}
if (DEE) {
	tools.push({
		name: "dee",
		decrypt: (input) => run(DEE, ["crypt", "-d", "-u", "quicknet"], input, deeEnv),
		encrypt: (input, round, armor) => run(DEE, ["crypt", "-e", "-u", "quicknet", "-r", String(round), ...(armor ? ["-a"] : [])], input, deeEnv),
	});
}

const ROUNDS = [2, 1_000_000, 20_000_000];
const SIZES = [0, 1, 16, 1000, 64 * 1024, 64 * 1024 + 1];
const NOTES = [
	{ includeInstructions: false, includeUnlockTime: false },
	{ includeInstructions: true, includeUnlockTime: false },
	{ includeInstructions: false, includeUnlockTime: true },
	{ includeInstructions: true, includeUnlockTime: true },
];

/** Deterministic pseudo-random bytes, including every byte value, so binary handling is exercised. */
function bytes(size: number, seed: number): Uint8Array<ArrayBuffer> {
	const out = new Uint8Array(size);
	let x = seed * 2654435761 + 1;
	for (let i = 0; i < size; i++) {
		x = (x * 1103515245 + 12345) >>> 0;
		out[i] = x >>> 24;
	}
	return out;
}

const deps = () => makeDeps({ drand: createDrandClient() }).deps;

/** What a user hands another tool: the BEGIN…END block when there are notes, otherwise the output as-is. */
const forOtherTools = (ciphertext: string) => new TextEncoder().encode(extractArmor(ciphertext)?.block ?? ciphertext);

async function encryptVia(path: "browser" | "api" | "legacy", plaintext: Uint8Array<ArrayBuffer>, round: number, notes: (typeof NOTES)[number]) {
	if (path === "browser") return encrypt(plaintext, round, createDrandClient());
	if (path === "legacy") return (await legacyEncrypt(post(`/encrypt/${round}`, plaintext), String(round), deps())).text();
	const res = await apiEncrypt(postJson("/api/encrypt", { plaintext: Buffer.from(plaintext).toString("base64"), encoding: "base64", round, ...notes }), deps());
	expect(res.status).toBe(200);
	return ((await res.json()) as { ciphertext: string }).ciphertext;
}

describe.skipIf(tools.length === 0)("interop with Go tle and dee", () => {
	beforeAll(() => {
		if (DEE) run(DEE, ["remote", "add", "quicknet", `${RELAY}/${QUICKNET.hash}`], new Uint8Array(), deeEnv);
	});

	const PATHS = ["browser", "api", "legacy"] as const;
	// The JSON API only takes 1 byte to LIMITS.plaintextBytes.
	const pathFor = (i: number, size: number) => (PATHS[i % 3] === "api" && (size === 0 || size > LIMITS.plaintextBytes) ? "legacy" : PATHS[i % 3]);
	const cases = ROUNDS.flatMap((round, r) =>
		SIZES.map((size, s) => ({ round, size, seed: r * 10 + s, path: pathFor(r + s, size), notes: NOTES[(r + s) % 4] })),
	);
	for (const notes of NOTES) {
		for (const path of PATHS) cases.push({ round: 1_000_000, size: 100, seed: 99, path, notes });
	}

	// Fresh random cases each run; rerun one with INTEROP_SEED=<seed from the test name>.
	const seed = Number(process.env.INTEROP_SEED ?? Date.now() % 1_000_000);
	const rand = bytes(64, seed);
	const latestRound = currentRound() - 10;
	for (let i = 0; i < 8; i++) {
		const n = new DataView(rand.buffer, i * 8, 8);
		const size = n.getUint32(4) % (2 * 64 * 1024 + 2);
		cases.push({ round: 1 + (n.getUint32(0) % latestRound), size, seed: seed + i, path: pathFor(n.getUint8(0), size), notes: NOTES[n.getUint8(1) % 4] });
	}

	for (const tool of tools) {
		it.each(cases)(`site encrypts, ${tool.name} decrypts: $path, round $round, $size bytes, seed $seed, notes $notes`, async ({ round, size, seed, path, notes }) => {
			const plaintext = bytes(size, seed);
			const ciphertext = await encryptVia(path, plaintext, round, notes);
			expect(tool.decrypt(forOtherTools(ciphertext))).toEqual(Buffer.from(plaintext));
		}, 120_000);

		it.each(ROUNDS.flatMap((round, r) => [true, false].map((armor) => ({ round, armor, size: SIZES[(r * 2 + Number(armor)) % SIZES.length] }))))(
			`${tool.name} encrypts, site decrypts: round $round, armor $armor, $size bytes`,
			async ({ round, armor, size }) => {
				const plaintext = bytes(size, round);
				const ciphertext = tool.encrypt(plaintext, round, armor);
				const legacy = await legacyDecrypt(post("/decrypt", new Uint8Array(ciphertext)), deps());
				expect(Buffer.from(await legacy.arrayBuffer())).toEqual(Buffer.from(plaintext));
				if (!armor) return;
				const pasted = `Unlock at https://timelock.dev\r\n\r\n${ciphertext.toString("latin1").replace(/\n/g, "\r\n")}  \n`;
				const res = await apiDecrypt(postJson("/api/decrypt", { ciphertext: pasted, encoding: "base64" }), deps());
				expect(Buffer.from(((await res.json()) as { plaintext: string }).plaintext, "base64")).toEqual(Buffer.from(plaintext));
			},
			120_000,
		);
	}
});
