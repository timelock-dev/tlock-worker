import type { ChainClient, ChainInfo, RandomnessBeacon } from "drand-client";

/** drand quicknet: the chain the original Rust worker used. Pinned so a compromised relay cannot swap keys. */
export const QUICKNET: ChainInfo = {
	public_key:
		"83cf0f2896adee7eb8b5f01fcad3912212c437e0073e911fb90022d3e760183c8c4b450b6a0a6c3ac6a5776a2d1064510d1fec758c921cc22b0e17e63aaf4bcb5ed66304de9cf809bd274ca73bab4af5a6e9c76a4bc09e76eae8991ef5ece45a",
	period: 3,
	genesis_time: 1692803367,
	hash: "52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971",
	groupHash: "f477d5c89f21a17c863a7f937c6a6d15859414d2be09cd448d4279af331c5d3e",
	schemeID: "bls-unchained-g1-rfc9380",
	metadata: { beaconID: "quicknet" },
};

/** Relays tried in order. Every beacon is BLS-verified against QUICKNET.public_key, so relays are untrusted. */
export const DRAND_RELAYS = [
	"https://drand.cloudflare.com",
	"https://api.drand.sh",
	"https://api2.drand.sh",
	"https://api3.drand.sh",
];

export class DrandUnavailableError extends Error {}

export function roundTime(round: number, chain: ChainInfo = QUICKNET): number {
	return (chain.genesis_time + (Math.max(round, 1) - 1) * chain.period) * 1000;
}

/** Latest round already published at `ms`. */
export function currentRound(ms: number = Date.now(), chain: ChainInfo = QUICKNET): number {
	return Math.floor((ms / 1000 - chain.genesis_time) / chain.period) + 1;
}

/** First round published at or after `ms`, i.e. the round to encrypt to for an unlock time of `ms`. */
export function roundForTime(ms: number, chain: ChainInfo = QUICKNET): number {
	return Math.max(1, Math.ceil((ms / 1000 - chain.genesis_time) / chain.period) + 1);
}

type Fetch = typeof fetch;

export function createDrandClient({
	relays = DRAND_RELAYS,
	fetch: doFetch = (...args) => fetch(...args),
	timeoutMs = 5000,
}: { relays?: string[]; fetch?: Fetch; timeoutMs?: number } = {}): ChainClient {
	const get = async (path: string): Promise<RandomnessBeacon> => {
		let lastError: unknown;
		for (const relay of relays) {
			try {
				const res = await doFetch(`${relay}/${QUICKNET.hash}${path}`, {
					signal: AbortSignal.timeout(timeoutMs),
				});
				if (res.ok) return (await res.json()) as RandomnessBeacon;
				lastError = new Error(`${relay} responded ${res.status}`);
			} catch (err) {
				lastError = err;
			}
		}
		throw new DrandUnavailableError(`No drand relay could serve ${path}: ${String(lastError)}`);
	};
	return {
		options: {
			disableBeaconVerification: false,
			noCache: false,
			chainVerificationParams: { chainHash: QUICKNET.hash, publicKey: QUICKNET.public_key },
		},
		chain: () => ({ baseUrl: `${relays[0]}/${QUICKNET.hash}`, info: async () => QUICKNET }),
		latest: () => get("/public/latest"),
		get: (round) => get(`/public/${round}`),
	};
}
