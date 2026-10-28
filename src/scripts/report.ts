import type { EventType } from "../lib/events";

export const EVENT_REPORTED = "timelock:event";

const SEEN_KEY = "timelock:reported";
const SEEN_MAX = 200;
const seenInPage = new Set<string>();

type SeenStore = Pick<Storage, "getItem" | "setItem">;

function sessionStore(): SeenStore | null {
	try {
		return typeof sessionStorage === "undefined" ? null : sessionStorage;
	} catch {
		return null;
	}
}

function readSeen(store: SeenStore | null): string[] {
	try {
		const list = JSON.parse(store?.getItem(SEEN_KEY) ?? "[]");
		return Array.isArray(list) ? list : [];
	} catch {
		return [];
	}
}

async function digest(text: string): Promise<string> {
	const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
	return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Tells the server an encryption/decryption happened (type + round only) so it shows up in recent activity on the homepage. */
export function reportEvent(type: EventType, round: number): void {
	fetch("/api/events", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ type, round }),
		keepalive: true,
	})
		.then((res) => {
			if (res.ok) window.dispatchEvent(new CustomEvent(EVENT_REPORTED));
		})
		.catch(() => {});
}

/**
 * Reports an event at most once per message per browser tab, so decrypting the same text again (or reloading and decrypting it)
 * isn't counted twice. `message` is the armored block; only its SHA-256 is kept, in sessionStorage.
 */
export async function reportEventOnce(type: EventType, round: number, message: string, store: SeenStore | null = sessionStore()): Promise<boolean> {
	const id = await digest(`${type}\n${message}`);
	const seen = readSeen(store);
	if (seenInPage.has(id) || seen.includes(id)) return false;
	seenInPage.add(id);
	try {
		store?.setItem(SEEN_KEY, JSON.stringify([...seen, id].slice(-SEEN_MAX)));
	} catch {
		/* storage full or blocked: the in-page set still dedupes */
	}
	reportEvent(type, round);
	return true;
}
