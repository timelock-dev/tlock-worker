import { describe, expect, it } from "vitest";
import { currentRound, QUICKNET, roundForTime, roundTime } from "../src/lib/drand";
import {
	formatCountdown,
	formatApproxDuration,
	formatDuration,
	formatFriendly,
	formatLocal,
	formatRelative,
	formatUtc,
	joinList,
	parseDuration,
	parseTimestamp,
	zonedParts,
	zonedTimeToUtc,
} from "../src/lib/time";

const DAY = 86400;

describe("formatDuration", () => {
	it.each([
		[300, "5 minutes"],
		[1, "1 second"],
		[0, "0 seconds"],
		[59, "59 seconds"],
		[3600, "1 hour"],
		[3 * DAY + 6 * 3600 + 45 * 60, "3 days, 6 hours and 45 minutes"],
		[DAY + 30, "1 day"],
		[DAY + 60 + 1, "1 day and 1 minute"],
		[7 * DAY, "7 days"],
		[365 * DAY, "1 year"],
		[2 * 365 * DAY + 3 * DAY + 3600, "2 years, 3 days and 1 hour"],
		[3725, "1 hour, 2 minutes and 5 seconds"],
		[299.6, "5 minutes"],
	])("%s s → %s", (seconds, expected) => {
		expect(formatDuration(seconds)).toBe(expected);
	});

	it("honours maxUnits", () => {
		expect(formatDuration(3725, 1)).toBe("1 hour");
		expect(formatDuration(3725, 5)).toBe("1 hour, 2 minutes and 5 seconds");
	});

	it("uses thousands separators for large counts", () => {
		expect(formatDuration(1500 * 365 * DAY)).toBe("1,500 years");
	});
});

describe("joinList", () => {
	it("joins without an Oxford comma", () => {
		expect(joinList([])).toBe("");
		expect(joinList(["a"])).toBe("a");
		expect(joinList(["a", "b"])).toBe("a and b");
		expect(joinList(["a", "b", "c"])).toBe("a, b and c");
	});
});

describe("formatCountdown", () => {
	it.each([
		[0, "0s"],
		[-5, "0s"],
		[42, "42s"],
		[300, "5m 0s"],
		[3 * DAY + 6 * 3600 + 45 * 60 + 12, "3d 6h 45m 12s"],
		[3600, "1h 0m 0s"],
	])("%s s → %s", (seconds, expected) => {
		expect(formatCountdown(seconds)).toBe(expected);
	});
});

describe("parseDuration", () => {
	it.each([
		["300", 300],
		[300, 300],
		["300s", 300],
		["5m", 300],
		["5 min", 300],
		["5 minutes", 300],
		["1h30m", 5400],
		["1.5h", 5400],
		["1.5 hours", 5400],
		["2d", 2 * DAY],
		["1w", 7 * DAY],
		["1 year", 365 * DAY],
		["3 days, 6 hours and 45 minutes", 3 * DAY + 6 * 3600 + 45 * 60],
		["  2H 5M  ", 7500],
		["0.4", null],
	])("%j → %j", (input, expected) => {
		expect(parseDuration(input)).toBe(expected);
	});

	it.each(["", "abc", "5 parsecs", "-5m", "0", "0s", "5m abc", "m5", "1h 30", "NaN"])("rejects %j", (input) => {
		expect(parseDuration(input)).toBeNull();
	});

	it("round-trips formatDuration output", () => {
		for (const s of [300, 3600, 3 * DAY + 6 * 3600 + 45 * 60, 365 * DAY, 3725]) {
			expect(parseDuration(formatDuration(s, 5))).toBe(s);
		}
	});
});

describe("absolute times", () => {
	const t = Date.UTC(2026, 9, 22, 0, 51, 3);

	it("formats UTC", () => {
		expect(formatUtc(t)).toBe("2026-10-22 00:51:03 UTC");
	});

	it("formats local time with a time zone indicator", () => {
		expect(formatLocal(t, { timeZone: "Europe/Berlin" })).toBe("Thu, Oct 22, 2026, 02:51:03 GMT+2");
		expect(formatLocal(t, { timeZone: "UTC" })).toBe("Thu, Oct 22, 2026, 00:51:03 UTC");
		expect(formatLocal(t)).toMatch(/Oct 21, 2026, 20:51:03 EDT$/);
	});

});

describe("friendly formats", () => {
	it("formats a date and time for sentences", () => {
		const t = Date.UTC(2026, 10, 21, 13, 51, 6);
		expect(formatFriendly(t)).toBe("Sat, Nov 21, 2026 at 8:51 AM EST");
		expect(formatFriendly(t, { timeZone: "UTC" })).toBe("Sat, Nov 21, 2026 at 1:51 PM UTC");
	});

	it.each([
		[29 * DAY + 23 * 3600, "30 days"],
		[90 * 60, "2 hours"],
		[3600, "1 hour"],
		[59, "59 seconds"],
		[0, "1 second"],
		[400 * DAY, "1 year"],
	])("approximates %i seconds as %s", (seconds, expected) => {
		expect(formatApproxDuration(seconds)).toBe(expected);
	});
});

describe("time zones", () => {
	it("reads the wall clock of an instant in any zone", () => {
		const t = Date.UTC(2026, 9, 22, 0, 51, 3);
		expect(zonedParts(t, "Asia/Tokyo")).toEqual({ year: 2026, month: 10, day: 22, hour: 9, minute: 51, second: 3 });
		expect(zonedParts(t, "America/Los_Angeles")).toEqual({ year: 2026, month: 10, day: 21, hour: 17, minute: 51, second: 3 });
	});

	it("converts a wall-clock time in a zone to an instant", () => {
		expect(zonedTimeToUtc({ year: 2030, month: 1, day: 1, hour: 0, minute: 0 }, "UTC")).toBe(Date.UTC(2030, 0, 1));
		expect(zonedTimeToUtc({ year: 2030, month: 1, day: 1, hour: 9, minute: 0 }, "Asia/Tokyo")).toBe(Date.UTC(2030, 0, 1, 0));
		expect(zonedTimeToUtc({ year: 2026, month: 7, day: 1, hour: 9, minute: 30 }, "Europe/Paris")).toBe(Date.UTC(2026, 6, 1, 7, 30));
		expect(zonedTimeToUtc({ year: 2026, month: 12, day: 1, hour: 9, minute: 30 }, "Asia/Kolkata")).toBe(Date.UTC(2026, 11, 1, 4, 0));
	});

	it("handles daylight saving changes", () => {
		const ny = (month: number, day: number, hour: number, minute = 0) => zonedTimeToUtc({ year: 2026, month, day, hour, minute }, "America/New_York");
		expect(ny(11, 1, 5)).toBe(Date.UTC(2026, 10, 1, 10)); // just after fall-back, EST
		expect(ny(11, 1, 1, 30)).toBe(Date.UTC(2026, 10, 1, 5, 30)); // repeated hour: first occurrence (EDT)
		expect(ny(3, 8, 2, 30)).toBe(Date.UTC(2026, 2, 8, 7, 30)); // skipped hour: 03:30 EDT
		expect(ny(3, 8, 12)).toBe(Date.UTC(2026, 2, 8, 16));
	});
});

describe("formatRelative", () => {
	const now = Date.UTC(2026, 9, 22, 12, 0, 0);
	it.each([
		[0, "just now"],
		[-5_000, "just now"],
		[-42_000, "42 sec ago"],
		[-12 * 60_000, "12 min ago"],
		[8 * 60_000, "in 8 min"],
		[-3600_000, "1 hour ago"],
		[-3 * 3600_000, "3 hours ago"],
		[2 * DAY * 1000, "in 2 days"],
		[-45 * DAY * 1000, "1 month ago"],
		[3 * 365 * DAY * 1000, "in 3 years"],
	])("%s ms → %s", (offset, expected) => {
		expect(formatRelative(now + offset, now)).toBe(expected);
	});
});

describe("parseTimestamp", () => {
	it("accepts unix seconds and ISO 8601 with an offset", () => {
		expect(parseTimestamp(1893456000)).toBe(1893456000_000);
		expect(parseTimestamp("1893456000")).toBe(1893456000_000);
		expect(parseTimestamp("2030-01-01T00:00:00Z")).toBe(1893456000_000);
		expect(parseTimestamp("2030-01-01T09:00:00+09:00")).toBe(1893456000_000);
		expect(parseTimestamp("2030-01-01T00:00Z")).toBe(1893456000_000);
		expect(parseTimestamp("2030-01-01T00:00:00.500Z")).toBe(1893456000_500);
	});

	it.each(["2030-01-01T00:00:00", "2030-01-01", "tomorrow", "", null, undefined, {}, -5, Number.NaN])("rejects %j", (v) => {
		expect(parseTimestamp(v)).toBeNull();
	});
});

describe("drand round math", () => {
	it("maps rounds to quicknet times", () => {
		expect(roundTime(1)).toBe(QUICKNET.genesis_time * 1000);
		expect(roundTime(1000000)).toBe((QUICKNET.genesis_time + 999999 * 3) * 1000);
	});

	it("rounds unlock times up to the next round", () => {
		const r = 1000000;
		expect(roundForTime(roundTime(r))).toBe(r);
		expect(roundForTime(roundTime(r) + 1)).toBe(r + 1);
		expect(roundForTime(roundTime(r) - 1)).toBe(r);
		expect(roundTime(roundForTime(Date.UTC(2030, 0, 1)))).toBeGreaterThanOrEqual(Date.UTC(2030, 0, 1));
	});

	it("reports the latest published round", () => {
		const r = 1000000;
		expect(currentRound(roundTime(r))).toBe(r);
		expect(currentRound(roundTime(r) - 1)).toBe(r - 1);
		expect(currentRound(roundTime(r) + 2999)).toBe(r);
	});
});
