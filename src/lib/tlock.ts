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
}

/** Converts ciphertext bytes to the latin1 "binary" string tlock-js expects (works for armored and binary age). */
export function bytesToBinaryString(bytes: Uint8Array): string {
	return Buffer.from(bytes).toString("binary");
}

function ageHeader(ciphertext: string): string {
	const trimmed = ciphertext.trim();
	if (trimmed.startsWith(ARMOR_HEADER)) {
		if (!trimmed.endsWith(ARMOR_FOOTER)) throw new InvalidCiphertextError("Armored ciphertext is missing its END line.");
		const body = trimmed.slice(ARMOR_HEADER.length, -ARMOR_FOOTER.length).replace(/\s+/g, "");
		return Buffer.from(body, "base64").toString("binary");
	}
	return ciphertext;
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
	return {
		round,
		chainHash: match[2],
		unlockAt: roundTime(round),
		armored: ciphertext.trimStart().startsWith(ARMOR_HEADER),
	};
}

/** Encrypts to a drand round. Returns armored age, byte-compatible with the Rust tlock_age output. */
export async function encrypt(plaintext: Uint8Array, round: number, client: ChainClient): Promise<string> {
	return timelockEncrypt(round, Buffer.from(plaintext), client);
}

export async function decrypt(ciphertext: string, client: ChainClient, now = Date.now()): Promise<{ plaintext: Uint8Array; info: CiphertextInfo }> {
	const info = inspectCiphertext(ciphertext);
	if (info.chainHash !== QUICKNET.hash) {
		throw new UnsupportedChainError(`Ciphertext targets drand chain ${info.chainHash}; only quicknet (${QUICKNET.hash}) is supported.`);
	}
	if (info.unlockAt > now) throw new TooEarlyError(info.round, info.unlockAt);
	try {
		const plaintext = await timelockDecrypt(ciphertext, client);
		return { plaintext: new Uint8Array(plaintext), info };
	} catch (err) {
		if (err instanceof DrandUnavailableError) throw err;
		if (err instanceof Error && /too early/i.test(err.message)) throw new TooEarlyError(info.round, info.unlockAt);
		throw new InvalidCiphertextError(`Decryption failed: ${err instanceof Error ? err.message : String(err)}`);
	}
}
