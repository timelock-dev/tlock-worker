import { Buffer, timelockDecrypt, timelockEncrypt } from "tlock-js";
import type { ChainClient } from "drand-client";
import { DrandUnavailableError, QUICKNET, roundTime } from "./drand";

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

export async function decrypt(ciphertext: string, client: ChainClient, now = Date.now()): Promise<{ plaintext: Uint8Array<ArrayBuffer>; info: CiphertextInfo }> {
	const info = inspectCiphertext(ciphertext);
	if (info.chainHash !== QUICKNET.hash) {
		throw new UnsupportedChainError(`Ciphertext targets drand chain ${info.chainHash}; only quicknet (${QUICKNET.hash}) is supported.`);
	}
	if (info.unlockAt > now) throw new TooEarlyError(info.round, info.unlockAt);
	try {
		const plaintext = await timelockDecrypt(extractArmor(ciphertext)?.block ?? ciphertext, client);
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
