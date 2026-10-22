import type { ChainClient } from "drand-client";
import { Buffer } from "tlock-js";
import { DrandUnavailableError, QUICKNET, currentRound, roundForTime, roundTime } from "./drand";
import { eventStats, listEvents, recordEvent, type EventsDb, type EventSource, type EventType } from "./events";
import { ApiError, errorJson, errorText, json, readBody, readJson } from "./http";
import { noteLines, withNotes, type NoteOptions } from "./notes";
import { parseDuration, parseTimestamp } from "./time";
import {
	InvalidCiphertextError,
	TooEarlyError,
	UnsupportedChainError,
	bytesToBinaryString,
	decrypt,
	encrypt,
} from "./tlock";

export const LIMITS = {
	/** JSON API: decoded plaintext. */
	plaintextBytes: 64 * 1024,
	/** JSON API: whole request body (base64 plaintext or armored ciphertext plus JSON overhead). */
	jsonBodyBytes: 192 * 1024,
	/** Legacy /encrypt/:round and /decrypt raw bodies. */
	legacyBodyBytes: 5 * 1024 * 1024,
	/** How far ahead a message may be locked. */
	maxUnlockSeconds: 100 * 365 * 86400,
	feedPageSize: 100,
} as const;

export interface Deps {
	drand: ChainClient;
	db?: EventsDb;
	waitUntil: (promise: Promise<unknown>) => void;
	now?: () => number;
}

const maxRound = (now: number) => roundForTime(now + LIMITS.maxUnlockSeconds * 1000);

function track(deps: Deps, type: EventType, source: EventSource, round: number) {
	if (!deps.db) return;
	const db = deps.db;
	deps.waitUntil(
		recordEvent(db, { type, source, round, unlockAt: roundTime(round), createdAt: (deps.now ?? Date.now)() }).catch((err) =>
			console.error("failed to record event", err),
		),
	);
}

function toApiError(err: unknown): ApiError {
	if (err instanceof ApiError) return err;
	if (err instanceof TooEarlyError) {
		return new ApiError(425, "too_early", err.message, {
			round: err.round,
			unlockAt: new Date(err.unlockAt).toISOString(),
			unlockAtUnix: err.unlockAt / 1000,
		});
	}
	if (err instanceof UnsupportedChainError) return new ApiError(422, "unsupported_chain", err.message);
	if (err instanceof InvalidCiphertextError) return new ApiError(422, "invalid_ciphertext", err.message);
	if (err instanceof DrandUnavailableError) {
		return new ApiError(502, "drand_unavailable", "The drand network could not be reached. Try again shortly.");
	}
	console.error(err);
	return new ApiError(500, "internal_error", "Unexpected server error.");
}

/** Resolves exactly one of `round`, `unlockAt` or `duration` to a drand round. */
export function resolveRound(body: Record<string, unknown>, now: number): number {
	const given = (["round", "unlockAt", "duration"] as const).filter((k) => body[k] !== undefined && body[k] !== null);
	if (given.length !== 1) {
		throw new ApiError(400, "invalid_request", "Provide exactly one of `duration`, `unlockAt` or `round`.");
	}
	const limit = maxRound(now);
	if (given[0] === "round") {
		const round = body.round;
		if (typeof round !== "number" || !Number.isSafeInteger(round) || round < 1 || round > limit) {
			throw new ApiError(400, "invalid_request", `\`round\` must be an integer between 1 and ${limit}.`);
		}
		return round;
	}
	let unlockAt: number | null;
	if (given[0] === "duration") {
		const seconds = typeof body.duration === "string" || typeof body.duration === "number" ? parseDuration(body.duration) : null;
		if (seconds === null) {
			throw new ApiError(400, "invalid_request", "`duration` must be a positive number of seconds or a string like \"5m\", \"2h30m\" or \"3 days\".");
		}
		unlockAt = now + seconds * 1000;
	} else {
		unlockAt = parseTimestamp(body.unlockAt);
		if (unlockAt === null) {
			throw new ApiError(400, "invalid_request", "`unlockAt` must be unix seconds or an ISO 8601 timestamp with a time zone, e.g. \"2030-01-01T00:00:00Z\".");
		}
		if (unlockAt <= now) throw new ApiError(400, "invalid_request", "`unlockAt` must be in the future.");
	}
	const round = roundForTime(unlockAt);
	if (round > limit) {
		throw new ApiError(400, "invalid_request", `Unlock time is too far ahead; the maximum is ${LIMITS.maxUnlockSeconds / (365 * 86400)} years.`);
	}
	return round;
}

function decodePlaintext(body: Record<string, unknown>): Uint8Array {
	const { plaintext, encoding = "utf8" } = body;
	if (typeof plaintext !== "string" || plaintext.length === 0) {
		throw new ApiError(400, "invalid_request", "`plaintext` must be a non-empty string.");
	}
	let bytes: Uint8Array;
	if (encoding === "utf8") bytes = new TextEncoder().encode(plaintext);
	else if (encoding === "base64") {
		if (!/^[A-Za-z0-9+/\s]*={0,2}\s*$/.test(plaintext)) throw new ApiError(400, "invalid_request", "`plaintext` is not valid base64.");
		bytes = new Uint8Array(Buffer.from(plaintext, "base64"));
	} else throw new ApiError(400, "invalid_request", "`encoding` must be \"utf8\" or \"base64\".");
	if (bytes.byteLength > LIMITS.plaintextBytes) {
		throw new ApiError(413, "payload_too_large", `Plaintext exceeds ${LIMITS.plaintextBytes.toLocaleString("en-US")} bytes. Use client-side encryption for larger files.`, {
			limitBytes: LIMITS.plaintextBytes,
		});
	}
	return bytes;
}

function encodePlaintext(bytes: Uint8Array, wanted: unknown): { plaintext: string; encoding: "utf8" | "base64" } {
	if (wanted !== "base64") {
		try {
			return { plaintext: new TextDecoder("utf-8", { fatal: true }).decode(bytes), encoding: "utf8" };
		} catch {
			/* not UTF-8: fall through to base64 */
		}
	}
	return { plaintext: Buffer.from(bytes).toString("base64"), encoding: "base64" };
}

function readNoteOptions(body: Record<string, unknown>): NoteOptions {
	const flag = (key: "includeInstructions" | "includeUnlockTime") => {
		const value = body[key] ?? false;
		if (typeof value !== "boolean") throw new ApiError(400, "invalid_request", `\`${key}\` must be true or false.`);
		return value;
	};
	const timeZone = body.timeZone ?? "UTC";
	if (typeof timeZone !== "string" || !isTimeZone(timeZone)) {
		throw new ApiError(400, "invalid_request", "`timeZone` must be an IANA time zone such as \"America/New_York\" or \"UTC\".");
	}
	return { instructions: flag("includeInstructions"), unlockTime: flag("includeUnlockTime"), timeZone };
}

function isTimeZone(zone: string): boolean {
	try {
		new Intl.DateTimeFormat("en-US", { timeZone: zone });
		return true;
	} catch {
		return false;
	}
}

const roundFields = (round: number) => ({
	round,
	unlockAt: new Date(roundTime(round)).toISOString(),
	unlockAtUnix: roundTime(round) / 1000,
});

/** POST /api/encrypt */
export async function apiEncrypt(request: Request, deps: Deps): Promise<Response> {
	try {
		const body = await readJson(request, LIMITS.jsonBodyBytes);
		const now = (deps.now ?? Date.now)();
		const round = resolveRound(body, now);
		const plaintext = decodePlaintext(body);
		const notes = readNoteOptions(body);
		const armored = await encrypt(plaintext, round, deps.drand);
		const ciphertext = withNotes(armored, noteLines(roundTime(round), notes));
		track(deps, "encrypt", "api", round);
		return json({ ciphertext, ...roundFields(round), chainHash: QUICKNET.hash, network: "quicknet" });
	} catch (err) {
		return errorJson(toApiError(err));
	}
}

/** POST /api/decrypt */
export async function apiDecrypt(request: Request, deps: Deps): Promise<Response> {
	try {
		const body = await readJson(request, LIMITS.jsonBodyBytes);
		if (typeof body.ciphertext !== "string" || !body.ciphertext.trim()) {
			throw new ApiError(400, "invalid_request", "`ciphertext` must be a string containing an armored age block (-----BEGIN AGE ENCRYPTED FILE-----).");
		}
		const { plaintext, info } = await decrypt(body.ciphertext, deps.drand, (deps.now ?? Date.now)());
		track(deps, "decrypt", "api", info.round);
		return json({ ...encodePlaintext(plaintext, body.encoding), ...roundFields(info.round) });
	} catch (err) {
		return errorJson(toApiError(err));
	}
}

/** POST /encrypt/:round — original Rust worker endpoint: raw body in, armored age out. */
export async function legacyEncrypt(request: Request, roundParam: string | undefined, deps: Deps): Promise<Response> {
	try {
		const round = Number(roundParam);
		if (!/^\d+$/.test(roundParam ?? "") || !Number.isSafeInteger(round) || round < 1) {
			throw new ApiError(400, "invalid_request", "round invalid");
		}
		const body = await readBody(request, LIMITS.legacyBodyBytes);
		const ciphertext = await encrypt(body, round, deps.drand);
		track(deps, "encrypt", "api", round);
		return new Response(ciphertext, { headers: { "Content-Type": "application/octet-stream" } });
	} catch (err) {
		return errorText(toApiError(err));
	}
}

/** POST /decrypt — original Rust worker endpoint: armored or binary age in, raw plaintext bytes out. */
export async function legacyDecrypt(request: Request, deps: Deps): Promise<Response> {
	try {
		const body = await readBody(request, LIMITS.legacyBodyBytes);
		const { plaintext, info } = await decrypt(bytesToBinaryString(body), deps.drand, (deps.now ?? Date.now)());
		track(deps, "decrypt", "api", info.round);
		return new Response(plaintext, { headers: { "Content-Type": "application/octet-stream" } });
	} catch (err) {
		return errorText(toApiError(err));
	}
}

/** POST /api/events — the website reports its own browser-side encryptions/decryptions. Same-origin only. */
export async function postEvent(request: Request, deps: Deps): Promise<Response> {
	try {
		if (request.headers.get("Origin") !== new URL(request.url).origin) {
			throw new ApiError(403, "forbidden", "Events can only be reported by the timelock.dev website.");
		}
		const body = await readJson(request, 1024);
		const now = (deps.now ?? Date.now)();
		const { type, round } = body;
		if (type !== "encrypt" && type !== "decrypt") throw new ApiError(400, "invalid_request", "`type` must be \"encrypt\" or \"decrypt\".");
		const upper = type === "decrypt" ? currentRound(now) : maxRound(now);
		if (typeof round !== "number" || !Number.isSafeInteger(round) || round < 1 || round > upper) {
			throw new ApiError(400, "invalid_request", `\`round\` must be an integer between 1 and ${upper}.`);
		}
		if (!deps.db) throw new ApiError(503, "feed_unavailable", "The activity feed is not configured.");
		await recordEvent(deps.db, { type, source: "web", round, unlockAt: roundTime(round), createdAt: now });
		return new Response(null, { status: 204 });
	} catch (err) {
		return errorJson(toApiError(err));
	}
}

/** GET /api/stats */
export async function getStats(deps: Pick<Deps, "db" | "now">): Promise<Response> {
	try {
		if (!deps.db) throw new ApiError(503, "feed_unavailable", "The activity feed is not configured.");
		const stats = await eventStats(deps.db, (deps.now ?? Date.now)());
		return json(stats, { headers: { "Cache-Control": "public, max-age=5" } });
	} catch (err) {
		return errorJson(toApiError(err));
	}
}

/** GET /api/events?limit=20&before=<id> */
export async function getEvents(url: URL, deps: Pick<Deps, "db">): Promise<Response> {
	try {
		if (!deps.db) throw new ApiError(503, "feed_unavailable", "The activity feed is not configured.");
		const limit = Number(url.searchParams.get("limit") ?? 20);
		const before = url.searchParams.has("before") ? Number(url.searchParams.get("before")) : undefined;
		if (!Number.isInteger(limit) || limit < 1 || limit > LIMITS.feedPageSize) {
			throw new ApiError(400, "invalid_request", `\`limit\` must be an integer between 1 and ${LIMITS.feedPageSize}.`);
		}
		if (before !== undefined && (!Number.isInteger(before) || before < 1)) {
			throw new ApiError(400, "invalid_request", "`before` must be a positive event id.");
		}
		const events = await listEvents(deps.db, { limit, before });
		const nextBefore = events.length === limit ? events[events.length - 1].id : null;
		return json({ events, nextBefore }, { headers: { "Cache-Control": "public, max-age=5" } });
	} catch (err) {
		return errorJson(toApiError(err));
	}
}
