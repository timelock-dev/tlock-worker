const UNITS = [
	{ name: "year", seconds: 365 * 86400, short: "y" },
	{ name: "day", seconds: 86400, short: "d" },
	{ name: "hour", seconds: 3600, short: "h" },
	{ name: "minute", seconds: 60, short: "m" },
	{ name: "second", seconds: 1, short: "s" },
] as const;

const UNIT_ALIASES: Record<string, number> = {
	s: 1, sec: 1, secs: 1, second: 1, seconds: 1,
	m: 60, min: 60, mins: 60, minute: 60, minutes: 60,
	h: 3600, hr: 3600, hrs: 3600, hour: 3600, hours: 3600,
	d: 86400, day: 86400, days: 86400,
	w: 604800, wk: 604800, wks: 604800, week: 604800, weeks: 604800,
	y: 31536000, yr: 31536000, yrs: 31536000, year: 31536000, years: 31536000,
};

/** "a", "a and b", "a, b and c" */
export function joinList(parts: string[]): string {
	if (parts.length <= 1) return parts.join("");
	return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

function split(totalSeconds: number): number[] {
	let rest = Math.max(0, Math.round(totalSeconds));
	return UNITS.map((u) => {
		const n = Math.floor(rest / u.seconds);
		rest -= n * u.seconds;
		return n;
	});
}

/**
 * Human-readable duration, e.g. 281100 → "3 days, 6 hours and 5 minutes".
 * Shows at most `maxUnits` consecutive units starting at the largest non-zero one (a year is 365 days).
 */
export function formatDuration(totalSeconds: number, maxUnits = 3): string {
	const counts = split(totalSeconds);
	const first = counts.findIndex((n) => n > 0);
	if (first === -1) return "0 seconds";
	const parts = UNITS.slice(first, first + maxUnits)
		.map((u, i) => [u, counts[first + i]] as const)
		.filter(([, n]) => n > 0)
		.map(([u, n]) => `${n.toLocaleString("en-US")} ${u.name}${n === 1 ? "" : "s"}`);
	return joinList(parts);
}

/** Compact countdown, e.g. "3d 6h 45m 12s"; leading zero units are dropped. */
export function formatCountdown(totalSeconds: number): string {
	const counts = split(totalSeconds);
	const first = counts.findIndex((n) => n > 0);
	if (first === -1) return "0s";
	return UNITS.slice(first)
		.map((u, i) => `${counts[first + i]}${u.short}`)
		.join(" ");
}

/**
 * Parses durations such as "300", "300s", "5m", "1h30m", "1.5 hours", "2 days, 3 hours and 4 minutes".
 * A bare number means seconds. Returns whole seconds, or null if the input is not a positive duration.
 */
export function parseDuration(input: string | number): number | null {
	if (typeof input === "number") return Number.isFinite(input) && Math.round(input) > 0 ? Math.round(input) : null;
	const text = input.trim().toLowerCase().replace(/,|\band\b/g, " ").trim();
	if (!text) return null;
	if (/^\d+(\.\d+)?$/.test(text)) return parseDuration(Number(text));
	const token = /(\d+(?:\.\d+)?)\s*([a-z]+)\s*/gy;
	let total = 0;
	let match: RegExpExecArray | null;
	let consumed = 0;
	while ((match = token.exec(text))) {
		const unit = UNIT_ALIASES[match[2]];
		if (!unit) return null;
		total += Number(match[1]) * unit;
		consumed = token.lastIndex;
	}
	if (consumed !== text.length) return null;
	return parseDuration(total);
}

const pad = (n: number) => String(n).padStart(2, "0");

/** "2026-10-22 00:51:03 UTC" */
export function formatUtc(ms: number): string {
	const d = new Date(ms);
	return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} UTC`;
}

/** Wall-clock time with a time zone indicator, e.g. "Thu, Oct 22, 2026, 02:51:03 GMT+2". */
export function formatLocal(ms: number, opts: { timeZone?: string; locale?: string } = {}): string {
	return new Intl.DateTimeFormat(opts.locale ?? "en-US", {
		weekday: "short",
		year: "numeric",
		month: "short",
		day: "numeric",
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
		hourCycle: "h23",
		timeZoneName: "short",
		timeZone: opts.timeZone,
	}).format(ms);
}

/** "just now", "42 sec ago", "12 min ago", "in 3 hours", "2 days ago", … */
export function formatRelative(targetMs: number, nowMs: number = Date.now()): string {
	const diff = (targetMs - nowMs) / 1000;
	const abs = Math.abs(diff);
	if (abs < 10) return "just now";
	const steps: [number, string, boolean][] = [
		[60, "sec", false],
		[3600, "min", false],
		[86400, "hour", true],
		[30 * 86400, "day", true],
		[365 * 86400, "month", true],
		[Infinity, "year", true],
	];
	const divisors = [1, 60, 3600, 86400, 30 * 86400, 365 * 86400];
	const i = steps.findIndex(([limit]) => abs < limit);
	const n = Math.floor(abs / divisors[i]);
	const [, unit, plural] = steps[i];
	const label = `${n} ${unit}${plural && n !== 1 ? "s" : ""}`;
	return diff < 0 ? `${label} ago` : `in ${label}`;
}

/**
 * Parses an API timestamp: unix seconds (number or numeric string) or ISO 8601 with an explicit offset or "Z".
 * Returns epoch milliseconds, or null.
 */
export function parseTimestamp(value: unknown): number | null {
	if (typeof value === "number") return Number.isFinite(value) && value > 0 ? value * 1000 : null;
	if (typeof value !== "string") return null;
	const v = value.trim();
	if (/^\d+(\.\d+)?$/.test(v)) return parseTimestamp(Number(v));
	if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/i.test(v)) return null;
	const ms = Date.parse(v);
	return Number.isNaN(ms) ? null : ms;
}

export interface WallTime {
	year: number;
	/** 1–12 */
	month: number;
	day: number;
	hour: number;
	minute: number;
	second: number;
}

const partsFormatters = new Map<string, Intl.DateTimeFormat>();

/** The wall-clock date and time of an instant in an IANA time zone. */
export function zonedParts(ms: number, timeZone: string): WallTime {
	let fmt = partsFormatters.get(timeZone);
	if (!fmt) {
		fmt = new Intl.DateTimeFormat("en-US", {
			timeZone,
			hourCycle: "h23",
			year: "numeric",
			month: "numeric",
			day: "numeric",
			hour: "numeric",
			minute: "numeric",
			second: "numeric",
		});
		partsFormatters.set(timeZone, fmt);
	}
	const get = (type: string) => Number(fmt.formatToParts(ms).find((p) => p.type === type)?.value);
	return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour"), minute: get("minute"), second: get("second") };
}

function zoneOffset(ms: number, timeZone: string): number {
	const p = zonedParts(ms, timeZone);
	return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ms / 1000) * 1000;
}

/**
 * The instant at which `wall` is shown on clocks in `timeZone`. A time repeated by a DST change resolves to its first occurrence; a time
 * skipped by one resolves to the same distance past the jump (02:30 on a spring-forward night becomes 03:30).
 */
export function zonedTimeToUtc(wall: Omit<WallTime, "second"> & { second?: number }, timeZone: string): number {
	const asUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second ?? 0);
	const candidates = [-1, 0, 1].map((d) => asUtc - zoneOffset(asUtc + d * 86400_000, timeZone));
	const matching = candidates.filter((ms) => zoneOffset(ms, timeZone) === asUtc - ms);
	return matching.length ? Math.min(...matching) : Math.max(...candidates);
}

/** The runtime's IANA time zone, e.g. "Europe/Paris". */
export function detectTimeZone(): string {
	return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

/** Readable date and time with a zone, e.g. "Sat, Nov 21, 2026 at 8:51 AM EST". */
export function formatFriendly(ms: number, opts: { timeZone?: string; locale?: string } = {}): string {
	const parts = new Intl.DateTimeFormat(opts.locale ?? "en-US", {
		weekday: "short",
		year: "numeric",
		month: "short",
		day: "numeric",
		hour: "numeric",
		minute: "2-digit",
		timeZoneName: "short",
		timeZone: opts.timeZone,
	}).formatToParts(ms);
	const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
	return `${get("weekday")}, ${get("month")} ${get("day")}, ${get("year")} at ${get("hour")}:${get("minute")} ${get("dayPeriod")} ${get("timeZoneName")}`;
}

/** A duration rounded to its largest unit, e.g. 29 days 23 hours → "30 days", 90 minutes → "2 hours". */
export function formatApproxDuration(totalSeconds: number): string {
	const s = Math.max(0, totalSeconds);
	const unit = UNITS.find((u) => s >= u.seconds) ?? UNITS[UNITS.length - 1];
	const n = Math.max(1, Math.round(s / unit.seconds));
	return `${n.toLocaleString("en-US")} ${unit.name}${n === 1 ? "" : "s"}`;
}
