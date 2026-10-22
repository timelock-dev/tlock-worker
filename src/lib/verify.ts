import type { ChainInfo, RandomnessBeacon } from "drand-client";
import { verifyBeacon } from "drand-client/beacon-verification";
import { currentRound, QUICKNET } from "./drand";

/** Relays the badge checks independently. */
export const VERIFY_RELAYS = ["https://api.drand.sh", "https://drand.cloudflare.com"];

/** Latest round may lag the clock (publishing, caching) or lead it slightly (clock skew). */
export const ROUND_TOLERANCE = 2;

export interface RelayCheck {
	relay: string;
	ok: boolean;
	chainHashOk: boolean;
	publicKeyOk: boolean;
	signatureOk: boolean;
	roundOk: boolean;
	round: number | null;
	expectedRound: number;
	error?: string;
}

export interface Verification {
	/** verified: every relay passed. warning: some passed. failed: none did. */
	status: "verified" | "warning" | "failed";
	round: number | null;
	checkedAt: number;
	relays: RelayCheck[];
}

type Fetch = typeof fetch;

async function getJson<T>(doFetch: Fetch, url: string, timeoutMs: number): Promise<T> {
	const res = await doFetch(url, { signal: AbortSignal.timeout(timeoutMs), cache: "no-store" });
	if (!res.ok) throw new Error(`HTTP ${res.status}`);
	return (await res.json()) as T;
}

/**
 * Checks one relay: its chain info must match the pinned quicknet hash and public key, and its latest beacon must carry a valid BLS
 * signature under the pinned key for a round within ROUND_TOLERANCE of the one expected now.
 */
export async function checkRelay(relay: string, { fetch: doFetch = (...a) => fetch(...a), now = Date.now(), timeoutMs = 5000 }: { fetch?: Fetch; now?: number; timeoutMs?: number } = {}): Promise<RelayCheck> {
	const expectedRound = currentRound(now);
	const check: RelayCheck = { relay, ok: false, chainHashOk: false, publicKeyOk: false, signatureOk: false, roundOk: false, round: null, expectedRound };
	try {
		const base = `${relay}/${QUICKNET.hash}`;
		const [info, beacon] = await Promise.all([
			getJson<ChainInfo>(doFetch, `${base}/info`, timeoutMs),
			getJson<RandomnessBeacon>(doFetch, `${base}/public/latest`, timeoutMs),
		]);
		check.chainHashOk = info.hash === QUICKNET.hash;
		check.publicKeyOk = info.public_key === QUICKNET.public_key;
		if (Number.isSafeInteger(beacon.round) && beacon.round > 0) {
			check.round = beacon.round;
			check.roundOk = Math.abs(beacon.round - expectedRound) <= ROUND_TOLERANCE;
			check.signatureOk = await verifyBeacon(QUICKNET, beacon, beacon.round).catch(() => false);
		}
		const failed = [
			!check.chainHashOk && "chain hash differs from quicknet",
			!check.publicKeyOk && "public key differs from the pinned key",
			!check.signatureOk && "beacon signature is invalid",
			!check.roundOk && (check.round === null ? "no round in the beacon" : `round is ${check.round}, expected about ${expectedRound}`),
		].filter(Boolean);
		if (failed.length) check.error = failed.join("; ");
		check.ok = failed.length === 0;
	} catch (err) {
		check.error = err instanceof Error && err.name === "TimeoutError" ? "timed out" : `unreachable (${err instanceof Error ? err.message : String(err)})`;
	}
	return check;
}

export async function verifyDrand(opts: { relays?: string[]; fetch?: Fetch; now?: number; timeoutMs?: number } = {}): Promise<Verification> {
	const now = opts.now ?? Date.now();
	const relays = await Promise.all((opts.relays ?? VERIFY_RELAYS).map((r) => checkRelay(r, { ...opts, now })));
	const passed = relays.filter((r) => r.ok);
	return {
		status: passed.length === relays.length ? "verified" : passed.length ? "warning" : "failed",
		round: passed.length ? Math.max(...passed.map((r) => r.round!)) : null,
		checkedAt: now,
		relays,
	};
}
