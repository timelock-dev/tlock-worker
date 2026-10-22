import { describe, expect, it } from "vitest";
import { eventDetail, eventRowHtml, lockLength, statsText } from "../src/lib/activity";
import type { FeedEvent } from "../src/lib/events";

const now = Date.UTC(2026, 9, 22, 12);
const event = (over: Partial<FeedEvent>): FeedEvent => ({
	id: 1,
	type: "encrypt",
	source: "web",
	createdAt: new Date(now - 5 * 60_000).toISOString(),
	round: 33279640,
	unlockAt: new Date(now + 3 * 3600_000).toISOString(),
	...over,
});

describe("stats sentence", () => {
	it("reads as plain English with real numbers", () => {
		expect(statsText({ days: 30, encrypted: 55, decrypted: 30, averageLockSeconds: 3 * 3600 + 12 * 60 })).toBe(
			"55 messages encrypted and 30 decrypted in the last 30 days. Average lock: 3 hours and 12 minutes.",
		);
	});

	it("handles one message and no average", () => {
		expect(statsText({ days: 30, encrypted: 0, decrypted: 1, averageLockSeconds: null })).toBe("0 messages encrypted and 1 decrypted in the last 30 days.");
		expect(statsText({ days: 30, encrypted: 1, decrypted: 0, averageLockSeconds: 300 })).toBe(
			"1 message encrypted and 0 decrypted in the last 30 days. Average lock: 5 minutes.",
		);
	});

	it("has a clean empty state", () => {
		expect(statsText({ days: 30, encrypted: 0, decrypted: 0, averageLockSeconds: null })).toBe("No messages encrypted or decrypted in the last 30 days.");
	});
});

describe("activity rows", () => {
	it("hides the round snap in lock lengths", () => {
		expect(lockLength(302)).toBe("5 minutes");
		expect(lockLength(42)).toBe("42 seconds");
		expect(lockLength(-5)).toBe("0 seconds");
	});

	it("describes encryptions by lock length and unlock time", () => {
		expect(eventDetail(event({}), now)).toBe("for 3 hours and 5 minutes · unlocks in 3 hours");
		expect(eventDetail(event({ unlockAt: new Date(now - 60_000).toISOString() }), now)).toBe("for 4 minutes · unlocked 1 min ago");
	});

	it("describes decryptions by when they unlocked", () => {
		expect(eventDetail(event({ type: "decrypt", unlockAt: new Date(now - 2 * 86400_000).toISOString() }), now)).toBe("unlocked 2 days ago");
	});

	it("renders one row with a time element and source label", () => {
		const html = eventRowHtml(event({ source: "api" }), now, "UTC");
		expect(html).toContain("<strong>Encrypted</strong>");
		expect(html).toContain('<span class="Label">API</span>');
		expect(html).toMatch(/<time [^>]*datetime="2026-10-22T11:55:00.000Z"[^>]*>5 min ago<\/time>/);
	});
});

describe("lock status panels", async () => {
	const { decryptStatePanelHtml, encryptedPanelHtml } = await import("../src/lib/status");
	const unlock = Date.UTC(2026, 10, 21, 13, 51, 6);
	const text = (html: string) => html.replace(/<svg[\s\S]*?<\/svg>/g, "").replace(/<[^>]+>/g, "|").replace(/\|+/g, "|");

	it("summarizes an encrypted message in one sentence", () => {
		expect(text(encryptedPanelHtml(unlock, 34155234, unlock - (29 * 86400 + 23 * 3600) * 1000))).toBe(
			"|Your message is encrypted|It can be opened on Sat, Nov 21, 2026 at 8:51 AM EST (in 30 days).|2026-11-21 13:51:06 UTC · drand round #34,155,234|",
		);
		expect(text(encryptedPanelHtml(unlock, 34155234, unlock + 1000))).toContain("It can be opened now.");
	});

	it("shows a locked message with local time, UTC, countdown and round on separate lines", () => {
		const html = decryptStatePanelHtml(unlock, 34155234, unlock - (2 * 3600 + 15 * 60) * 1000);
		expect(html).toContain("is-locked");
		expect(text(html)).toBe("|Still locked|Opens Sat, Nov 21, 2026 at 8:51 AM EST|2026-11-21 13:51:06 UTC|2 hours and 15 minutes to go|drand round #34,155,234|");
	});

	it("shows an unlocked message as ready", () => {
		const html = decryptStatePanelHtml(unlock, 34155234, unlock + 3 * 86400_000);
		expect(html).toContain("is-open");
		expect(text(html)).toContain("Ready to decrypt|Unlocked Sat, Nov 21, 2026 at 8:51 AM EST (3 days ago)");
	});
});
