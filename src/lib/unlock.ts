import { zonedParts, zonedTimeToUtc } from "./time";

/** Longest lock the website offers; matches the API limit. */
export const MAX_LOCK_SECONDS = 100 * 365 * 86400;

export const DURATION_UNITS = [
	{ value: "seconds", label: "seconds", seconds: 1 },
	{ value: "minutes", label: "minutes", seconds: 60 },
	{ value: "hours", label: "hours", seconds: 3600 },
	{ value: "days", label: "days", seconds: 86400 },
] as const;

export type DurationUnit = (typeof DURATION_UNITS)[number]["value"];

export type Target = { ms: number } | { error: string };

const unitSeconds = (unit: string) => DURATION_UNITS.find((u) => u.value === unit)?.seconds;

/** Unlock time for "after a duration": a positive number of seconds, minutes, hours or days, at most 100 years. */
export function durationTarget(amount: string, unit: string, now: number): Target {
	const perUnit = unitSeconds(unit);
	if (!perUnit) return { error: "Pick a unit." };
	if (!amount.trim()) return { error: "Enter how long to lock the message." };
	const n = Number(amount);
	if (!Number.isFinite(n) || n <= 0) return { error: "Enter a number greater than 0." };
	const seconds = Math.round(n * perUnit);
	if (seconds < 1) return { error: "The shortest lock is 1 second." };
	if (seconds > MAX_LOCK_SECONDS) return { error: `The longest lock is 100 years (${(MAX_LOCK_SECONDS / 86400).toLocaleString("en-US")} days).` };
	return { ms: now + seconds * 1000 };
}

export interface Day {
	year: number;
	/** 1–12 */
	month: number;
	day: number;
}

/** Negative if a is before b, 0 if the same day, positive if after. */
export const compareDays = (a: Day, b: Day) => a.year - b.year || a.month - b.month || a.day - b.day;

export function todayIn(timeZone: string, now: number): Day {
	const { year, month, day } = zonedParts(now, timeZone);
	return { year, month, day };
}

/** Parses "HH:MM" from <input type="time">. */
export function parseTimeOfDay(value: string): { hour: number; minute: number } | null {
	const m = /^(\d{2}):(\d{2})(?::\d{2})?$/.exec(value);
	if (!m) return null;
	const hour = Number(m[1]);
	const minute = Number(m[2]);
	return hour < 24 && minute < 60 ? { hour, minute } : null;
}

/** Unlock time for "at a date & time": a wall-clock day and time in `timeZone`, in the future and at most 100 years ahead. */
export function dateTarget(day: Day | null, time: string, timeZone: string, now: number): Target {
	if (!day) return { error: "Pick a day in the calendar." };
	const t = parseTimeOfDay(time);
	if (!t) return { error: "Enter a time, like 09:00." };
	const ms = zonedTimeToUtc({ ...day, ...t }, timeZone);
	if (ms <= now) {
		return { error: compareDays(day, todayIn(timeZone, now)) < 0 ? "That day has passed. Pick today or a later day." : "That time has passed. Pick a later time." };
	}
	if (ms > now + MAX_LOCK_SECONDS * 1000) return { error: "The latest unlock is 100 years from now." };
	return { ms };
}

/** Days of a month laid out in weeks starting on Sunday; null pads the first and last week. */
export function monthGrid(year: number, month: number): (Day | null)[][] {
	const first = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
	const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
	const cells: (Day | null)[] = Array.from({ length: first }, () => null);
	for (let day = 1; day <= days; day++) cells.push({ year, month, day });
	while (cells.length % 7) cells.push(null);
	return Array.from({ length: cells.length / 7 }, (_, w) => cells.slice(w * 7, w * 7 + 7));
}

export function addMonths(year: number, month: number, delta: number): { year: number; month: number } {
	const index = year * 12 + (month - 1) + delta;
	return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

/** IANA zones for the picker, always including the detected zone and UTC. */
export function timeZoneList(detected: string): string[] {
	let zones: string[] = [];
	try {
		zones = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf?.("timeZone") ?? [];
	} catch {
		zones = [];
	}
	return [...new Set([detected, "UTC", ...zones])].sort((a, b) => (a === detected ? -1 : b === detected ? 1 : a.localeCompare(b)));
}
