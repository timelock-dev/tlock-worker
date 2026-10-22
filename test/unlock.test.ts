import { describe, expect, it } from "vitest";
import { addMonths, dateTarget, durationTarget, MAX_LOCK_SECONDS, monthGrid, parseTimeOfDay, timeZoneList, todayIn } from "../src/lib/unlock";

const now = Date.UTC(2026, 9, 22, 13, 0, 0);

describe("durationTarget", () => {
	it.each([
		["5", "minutes", 300],
		["90", "seconds", 90],
		["1.5", "hours", 5400],
		["36500", "days", MAX_LOCK_SECONDS],
	])("%s %s", (amount, unit, seconds) => {
		expect(durationTarget(amount, unit, now)).toEqual({ ms: now + seconds * 1000 });
	});

	it.each([
		["", "minutes", /how long/],
		["0", "minutes", /greater than 0/],
		["-3", "hours", /greater than 0/],
		["abc", "hours", /greater than 0/],
		["0.2", "seconds", /shortest/],
		["36501", "days", /100 years \(36,500 days\)/],
		["5", "weeks", /unit/],
	])("rejects %j %s", (amount, unit, message) => {
		const t = durationTarget(amount, unit, now);
		expect("error" in t && t.error).toMatch(message);
	});
});

describe("dateTarget", () => {
	it("reads the day and time in the chosen zone", () => {
		expect(dateTarget({ year: 2026, month: 10, day: 23 }, "09:00", "Asia/Tokyo", now)).toEqual({ ms: Date.UTC(2026, 9, 23, 0) });
		expect(dateTarget({ year: 2026, month: 10, day: 22 }, "15:30", "UTC", now)).toEqual({ ms: Date.UTC(2026, 9, 22, 15, 30) });
	});

	it("blocks past days and times with a message", () => {
		expect(dateTarget({ year: 2026, month: 10, day: 21 }, "23:00", "UTC", now)).toEqual({ error: "That day has passed. Pick today or a later day." });
		expect(dateTarget({ year: 2026, month: 10, day: 22 }, "12:59", "UTC", now)).toEqual({ error: "That time has passed. Pick a later time." });
		expect(dateTarget({ year: 2026, month: 10, day: 22 }, "13:00", "UTC", now)).toEqual({ error: "That time has passed. Pick a later time." });
	});

	it("requires a day and a valid time, and caps at 100 years", () => {
		expect(dateTarget(null, "09:00", "UTC", now)).toEqual({ error: "Pick a day in the calendar." });
		expect(dateTarget({ year: 2026, month: 10, day: 23 }, "", "UTC", now)).toEqual({ error: "Enter a time, like 09:00." });
		expect(dateTarget({ year: 2127, month: 1, day: 1 }, "00:00", "UTC", now)).toEqual({ error: "The latest unlock is 100 years from now." });
	});

	it("knows which day it is in each zone", () => {
		const late = Date.UTC(2026, 9, 22, 23, 30);
		expect(todayIn("UTC", late)).toEqual({ year: 2026, month: 10, day: 22 });
		expect(todayIn("Asia/Tokyo", late)).toEqual({ year: 2026, month: 10, day: 23 });
	});
});

describe("picker helpers", () => {
	it("parses times of day", () => {
		expect(parseTimeOfDay("09:05")).toEqual({ hour: 9, minute: 5 });
		expect(parseTimeOfDay("23:59:30")).toEqual({ hour: 23, minute: 59 });
		expect(parseTimeOfDay("24:00")).toBeNull();
		expect(parseTimeOfDay("9:05")).toBeNull();
	});

	it("lays out a month in Sunday-first weeks", () => {
		const oct = monthGrid(2026, 10);
		expect(oct).toHaveLength(5);
		expect(oct[0].slice(0, 5)).toEqual([null, null, null, null, { year: 2026, month: 10, day: 1 }]);
		expect(oct[4].filter(Boolean).at(-1)).toEqual({ year: 2026, month: 10, day: 31 });
		expect(monthGrid(2026, 2).flat().filter(Boolean)).toHaveLength(28);
	});

	it("moves between months across years", () => {
		expect(addMonths(2026, 12, 1)).toEqual({ year: 2027, month: 1 });
		expect(addMonths(2026, 1, -1)).toEqual({ year: 2025, month: 12 });
	});

	it("lists the detected zone first", () => {
		const zones = timeZoneList("Europe/Paris");
		expect(zones[0]).toBe("Europe/Paris");
		expect(zones).toContain("UTC");
		expect(zones).toContain("Asia/Tokyo");
		expect(new Set(zones).size).toBe(zones.length);
	});
});
