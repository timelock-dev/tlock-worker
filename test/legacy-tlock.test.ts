import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { bls12_381 } from "@noble/curves/bls12-381";
import { bytesToNumberBE } from "@noble/curves/abstract/utils";
import { sha256 } from "@noble/hashes/sha256";
import { timelockDecrypt } from "tlock-js";
import { gtToHash } from "tlock-js/crypto/ibe";
import { legacyDecrypt, apiDecrypt } from "../src/lib/api";
import { QUICKNET, roundTime } from "../src/lib/drand";
import { legacyH3, unwrapLegacyRustTlock } from "../src/lib/legacy-tlock";
import { decrypt, InvalidCiphertextError } from "../src/lib/tlock";
import { BEACON, fakeDrand, makeDeps, post, postJson } from "./helpers";

/** Made by tlock_age 0.0.5 (the original Rust worker) at round 1000000; its first H3 counter is ≥ r. */
const OUT_OF_RANGE = readFileSync(new URL("./fixtures/rust-tlock-age-0.0.5-h3-out-of-range.age", import.meta.url), "utf8");
const OUT_OF_RANGE_PLAINTEXT = "legacy tlock_age 0.0.5 fixture: H3 out of range";
const AFTER = roundTime(BEACON.round) + 60_000;
const Fr = bls12_381.fields.Fr;
const G2 = bls12_381.G2.ProjectivePoint;

/** H3 as specified by drand (Go tlock, tlock-js, tlock ≥ 0.0.10): reject a masked hash ≥ r and try the next counter. */
function standardH3(sigma: Uint8Array, msg: Uint8Array): bigint {
	const inner = sha256.create().update("IBE-H3").update(sigma).update(msg).digest();
	for (let i = 1; i < 65535; i++) {
		const h = sha256.create().update(new Uint8Array([i & 0xff, i >> 8])).update(inner).digest();
		h[0] >>= 1;
		const n = bytesToNumberBE(h);
		if (n < Fr.ORDER) return n;
	}
	throw new Error("unreachable");
}

function roundGid(round: number) {
	const id = new Uint8Array(8);
	new DataView(id.buffer).setBigUint64(0, BigInt(round));
	const qid = bls12_381.G1.hashToCurve(sha256(id), { DST: "BLS_SIG_BLS12381G1_XMD:SHA-256_SSWU_RO_NUL_" });
	return bls12_381.pairing(qid as never, G2.fromHex(QUICKNET.public_key));
}
const GID = roundGid(BEACON.round);

/** The tlock 0.0.5 encoder for BEACON.round: U = rP with r = legacyH3. */
function legacyRustEncrypt(fileKey: Uint8Array, sigma: Uint8Array, gid = GID): Uint8Array {
	const r = legacyH3(sigma, fileKey);
	const V = sigma.map((b, i) => b ^ gtToHash(bls12_381.fields.Fp12.pow(gid, r), 16)[i]);
	const W = fileKey.map((b, i) => b ^ sha256.create().update("IBE-H4").update(sigma).digest()[i]);
	return new Uint8Array([...G2.BASE.multiply(r).toRawBytes(true), ...V, ...W]);
}

function flipLastBase64Char(armored: string, lineIndex: number): string {
	const lines = armored.split("\n");
	const line = lines[lineIndex];
	lines[lineIndex] = line.slice(0, 10) + (line[10] === "A" ? "B" : "A") + line.slice(11);
	return lines.join("\n");
}

describe("messages from the original Rust worker (tlock 0.0.5 H3)", () => {
	it("upstream tlock-js rejects them with the error users saw", async () => {
		await expect(timelockDecrypt(OUT_OF_RANGE, fakeDrand().client)).rejects.toThrow("invalid proof: rP check failed");
	});

	it("decrypt() opens them", async () => {
		const { plaintext } = await decrypt(OUT_OF_RANGE, fakeDrand().client, AFTER);
		expect(new TextDecoder().decode(plaintext)).toBe(OUT_OF_RANGE_PLAINTEXT);
	});

	it("decrypt() opens them with notes, CRLF line endings and surrounding whitespace", async () => {
		const pasted = `Unlock at https://timelock.dev\r\n\r\n  ${OUT_OF_RANGE.replace(/\n/g, "\r\n")}  \r\n`;
		const { plaintext } = await decrypt(pasted, fakeDrand().client, AFTER);
		expect(new TextDecoder().decode(plaintext)).toBe(OUT_OF_RANGE_PLAINTEXT);
	});

	it("POST /api/decrypt and POST /decrypt open them", async () => {
		const { deps } = makeDeps({ now: () => AFTER });
		const api = await apiDecrypt(postJson("/api/decrypt", { ciphertext: OUT_OF_RANGE }), deps);
		expect(await api.json()).toMatchObject({ plaintext: OUT_OF_RANGE_PLAINTEXT });
		const legacy = await legacyDecrypt(post("/decrypt", OUT_OF_RANGE), deps);
		expect(await legacy.text()).toBe(OUT_OF_RANGE_PLAINTEXT);
	});

	it("fetches the beacon once even when the fallback runs", async () => {
		const { client, calls } = fakeDrand();
		await decrypt(OUT_OF_RANGE, client, AFTER);
		expect(calls.filter((url) => url.endsWith(`/public/${BEACON.round}`))).toHaveLength(1);
	});

	it("still rejects a tampered stanza", async () => {
		// Line 4 of the armor holds the tlock stanza body (V and W bytes).
		await expect(decrypt(flipLastBase64Char(OUT_OF_RANGE, 4), fakeDrand().client, AFTER)).rejects.toThrow(InvalidCiphertextError);
	});
});

describe("legacy H3 model", () => {
	it("matches standard H3 exactly when the first counter is in range (~90.6%) and differs otherwise", () => {
		let differ = 0;
		const n = 4000;
		for (let i = 0; i < n; i++) {
			const sigma = sha256(new TextEncoder().encode(`sigma ${i}`)).subarray(0, 16);
			const msg = sha256(new TextEncoder().encode(`msg ${i}`)).subarray(0, 16);
			if (legacyH3(sigma, msg) !== standardH3(sigma, msg)) differ++;
		}
		expect(differ / n).toBeGreaterThan(0.075);
		expect(differ / n).toBeLessThan(0.115);
	});

	it("unwraps bodies a tlock 0.0.5-style encoder makes, in range or not", () => {
		const sig = Uint8Array.from(Buffer.from(BEACON.signature, "hex"));
		// tlock 0.0.5 drew sigma bytes from [0, 8).
		const sample = (i: number) => ({
			fileKey: sha256(new TextEncoder().encode(`key ${i}`)).subarray(0, 16),
			sigma: sha256(new TextEncoder().encode(`sigma ${i}`)).subarray(0, 16).map((b) => b & 7),
		});
		const cases = { inRange: [] as number[], outOfRange: [] as number[] };
		for (let i = 0; cases.inRange.length < 2 || cases.outOfRange.length < 2; i++) {
			const { fileKey, sigma } = sample(i);
			(legacyH3(sigma, fileKey) === standardH3(sigma, fileKey) ? cases.inRange : cases.outOfRange).push(i);
		}
		for (const i of [...cases.inRange.slice(0, 2), ...cases.outOfRange.slice(0, 2)]) {
			const { fileKey, sigma } = sample(i);
			expect(unwrapLegacyRustTlock(sig, legacyRustEncrypt(fileKey, sigma))).toEqual(fileKey);
		}
	}, 30_000);

	it("returns null for the wrong signature, a tampered V or W, or a malformed body", () => {
		const sig = Uint8Array.from(Buffer.from(BEACON.signature, "hex"));
		const fileKey = new Uint8Array(16).fill(1);
		const body = legacyRustEncrypt(fileKey, new Uint8Array(16).fill(3));
		expect(unwrapLegacyRustTlock(sig, body)).toEqual(fileKey);
		expect(unwrapLegacyRustTlock(bls12_381.G1.ProjectivePoint.BASE.multiply(5n).toRawBytes(true), body)).toBeNull();
		for (const offset of [96, 127]) {
			const tampered = body.slice();
			tampered[offset] ^= 1;
			expect(unwrapLegacyRustTlock(sig, tampered)).toBeNull();
		}
		expect(unwrapLegacyRustTlock(sig, body.subarray(0, 120))).toBeNull();
	});
});
