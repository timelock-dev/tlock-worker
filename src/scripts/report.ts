import type { EventType } from "../lib/events";

export const EVENT_REPORTED = "timelock:event";

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
