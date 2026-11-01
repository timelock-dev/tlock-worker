import { bytesToNumberBE } from "@noble/curves/abstract/utils";
import { bls12_381 } from "@noble/curves/bls12-381";
import { sha256 } from "@noble/hashes/sha256";
import { gtToHash } from "tlock-js/crypto/ibe";

const G2_POINT_BYTES = 96;
const KEY_BYTES = 16;
const Fr = bls12_381.fields.Fr;

const xor = (a: Uint8Array, b: Uint8Array) => a.map((x, i) => x ^ b[i]);

/**
 * H3 as implemented by the Rust `tlock` crate up to 0.0.9 (used by `tlock_age` ≤ 0.0.9, dee ≤ 0.0.20 and the original
 * Rust timelock.dev worker). It always takes the first counter's hash and reduces it mod r. Go, tlock-js and
 * `tlock` ≥ 0.0.10 reject a hash ≥ r and try the next counter instead, so the two disagree for ~9.4% of
 * ciphertexts and the spec-compliant decoders fail them with "rP check failed".
 */
export function legacyH3(sigma: Uint8Array, msg: Uint8Array): bigint {
	const inner = sha256.create().update("IBE-H3").update(sigma).update(msg).digest();
	const h = sha256.create().update(new Uint8Array([1, 0])).update(inner).digest();
	h[0] >>= 1;
	return Fr.create(bytesToNumberBE(h));
}

/**
 * Unwraps the age file key from a quicknet tlock stanza body (U ‖ V ‖ W, U on G2) using the legacy H3.
 * Keeps the U = rP check, so it only accepts ciphertexts that the legacy Rust encoder really produced.
 * Returns null if the body doesn't check out.
 */
export function unwrapLegacyRustTlock(signature: Uint8Array, body: Uint8Array): Uint8Array | null {
	if (body.length !== G2_POINT_BYTES + 2 * KEY_BYTES) return null;
	const U = bls12_381.G2.ProjectivePoint.fromHex(body.subarray(0, G2_POINT_BYTES));
	const V = body.subarray(G2_POINT_BYTES, G2_POINT_BYTES + KEY_BYTES);
	const W = body.subarray(G2_POINT_BYTES + KEY_BYTES);
	const sig = bls12_381.G1.ProjectivePoint.fromHex(signature);
	const sigma = xor(V, gtToHash(bls12_381.pairing(sig, U), KEY_BYTES));
	const fileKey = xor(W, sha256.create().update("IBE-H4").update(sigma).digest().subarray(0, KEY_BYTES));
	const r = legacyH3(sigma, fileKey);
	if (r === 0n || !bls12_381.G2.ProjectivePoint.BASE.multiply(r).equals(U)) return null;
	return fileKey;
}
