import { Buffer, timelockEncrypt } from "tlock-js";
import { decryptAge, type Stanza } from "tlock-js/age/age-encrypt-decrypt";
import { decodeArmor, isProbablyArmored } from "tlock-js/age/armor";
import { createTimelockDecrypter } from "tlock-js/drand/timelock-decrypter";
import { fetchBeacon, type ChainClient, type RandomnessBeacon } from "drand-client";
import { DrandUnavailableError, QUICKNET, roundTime } from "./drand";
import { unwrapLegacyRustTlock } from "./legacy-tlock";

const ARMOR_HEADER = "-----BEGIN AGE ENCRYPTED FILE-----";
const ARMOR_FOOTER = "-----END AGE ENCRYPTED FILE-----";
const STANZA = /^-> tlock (\d+) ([0-9a-f]{64})$/m;

export class InvalidCiphertextError extends Error {}
export class UnsupportedChainError extends Error {}
export class TooEarlyError extends Error {
	constructor(
		readonly round: number,
		readonly unlockAt: number,
	) {
		super(`Too early: this message unlocks at drand round ${round} (${new Date(unlockAt).toISOString()}).`);
	}
}

export interface CiphertextInfo {
	round: number;
	chainHash: string;
	unlockAt: number;
	armored: boolean;
	/** Non-empty lines found outside the BEGIN…END block. Not authenticated: anyone can edit them. */
	notes: string[];
}

/** Converts ciphertext bytes to the latin1 "binary" string tlock-js expects (works for armored and binary age). */
export function bytesToBinaryString(bytes: Uint8Array): string {
	return Buffer.from(bytes).toString("binary");
}

/**
 * Finds the armored age block in pasted text and returns it on its own, plus any lines around it.
 * Returns null for binary age or text without a BEGIN line.
 */
export function extractArmor(text: string): { block: string; notes: string[] } | null {
	if (text.startsWith("age-encryption.org/v1\n")) return null;
	const start = text.indexOf(ARMOR_HEADER);
	if (start < 0) return null;
	const end = text.indexOf(ARMOR_FOOTER, start);
	if (end < 0) throw new InvalidCiphertextError("Armored ciphertext is missing its END line.");
	const rest = text.slice(end + ARMOR_FOOTER.length);
	if (text.lastIndexOf(ARMOR_HEADER) !== start || rest.includes(ARMOR_FOOTER)) {
		throw new InvalidCiphertextError("This text has more than one encrypted block. Paste one at a time.");
	}
	const block = `${text.slice(start, end + ARMOR_FOOTER.length).replace(/\r\n?/g, "\n")}\n`;
	const notes = `${text.slice(0, start)}\n${rest}`
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter(Boolean);
	return { block, notes };
}

function ageHeader(ciphertext: string): string {
	const armor = extractArmor(ciphertext);
	if (!armor) return ciphertext;
	const body = armor.block.trim().slice(ARMOR_HEADER.length, -ARMOR_FOOTER.length).replace(/\s+/g, "");
	return Buffer.from(body, "base64").toString("binary");
}

/** Reads the round and chain hash from the tlock stanza of an age header without decrypting. */
export function inspectCiphertext(ciphertext: string): CiphertextInfo {
	const header = ageHeader(ciphertext);
	if (!header.startsWith("age-encryption.org/v1\n")) {
		throw new InvalidCiphertextError("Not an age ciphertext: expected an AGE ENCRYPTED FILE block.");
	}
	const match = STANZA.exec(header.slice(0, header.indexOf("\n---")));
	if (!match) throw new InvalidCiphertextError("No tlock recipient stanza found in the age header.");
	const round = Number(match[1]);
	const armor = extractArmor(ciphertext);
	return {
		round,
		chainHash: match[2],
		unlockAt: roundTime(round),
		armored: armor !== null,
		notes: armor?.notes ?? [],
	};
}

/** Encrypts to a drand round. Returns armored age, byte-compatible with the Rust tlock_age output. */
export async function encrypt(plaintext: Uint8Array, round: number, client: ChainClient): Promise<string> {
	return timelockEncrypt(round, Buffer.from(plaintext), client);
}

/**
 * tlock-js's stanza unwrapper, falling back to the legacy Rust H3 when the standard U = rP check fails, so messages made by
 * the original Rust worker (tlock_age 0.0.5) still open. See legacy-tlock.ts.
 */
function unwrapFileKey(client: ChainClient): (stanzas: Stanza[]) => Promise<Uint8Array> {
	const beacons = new Map<number, Promise<RandomnessBeacon>>();
	const cached: ChainClient = {
		options: client.options,
		chain: () => client.chain(),
		latest: () => client.latest(),
		get: (round) => {
			if (!beacons.has(round)) beacons.set(round, client.get(round));
			return beacons.get(round)!;
		},
	};
	const standard = createTimelockDecrypter(cached);
	return async (stanzas) => {
		try {
			return await standard(stanzas);
		} catch (err) {
			if (!(err instanceof Error && /rP check failed/.test(err.message))) throw err;
			const stanza = stanzas.find((s) => s.type === "tlock");
			if (!stanza) throw err;
			const beacon = await fetchBeacon(cached, Number(stanza.args[0]));
			const fileKey = unwrapLegacyRustTlock(Buffer.from(beacon.signature, "hex"), stanza.body);
			if (!fileKey) throw err;
			return fileKey;
		}
	};
}

export async function decrypt(ciphertext: string, client: ChainClient, now = Date.now()): Promise<{ plaintext: Uint8Array<ArrayBuffer>; info: CiphertextInfo }> {
	const info = inspectCiphertext(ciphertext);
	if (info.chainHash !== QUICKNET.hash) {
		throw new UnsupportedChainError(`Ciphertext targets drand chain ${info.chainHash}; only quicknet (${QUICKNET.hash}) is supported.`);
	}
	if (info.unlockAt > now) throw new TooEarlyError(info.round, info.unlockAt);
	try {
		const block = extractArmor(ciphertext)?.block ?? ciphertext;
		const plaintext = await decryptAge(isProbablyArmored(block) ? decodeArmor(block) : block, unwrapFileKey(client));
		return { plaintext: new Uint8Array(plaintext), info };
	} catch (err) {
		if (err instanceof DrandUnavailableError) throw err;
		if (err instanceof Error && /beacon retrieved was not valid/i.test(err.message)) {
			throw new DrandUnavailableError("A drand relay returned a beacon that failed signature verification.");
		}
		if (err instanceof Error && /too early/i.test(err.message)) throw new TooEarlyError(info.round, info.unlockAt);
		throw new InvalidCiphertextError(`Decryption failed: ${err instanceof Error ? err.message : String(err)}`);
	}
}
