import { formatSpan } from "./time";

/** Rendering helpers for the hosted message page (/m/<id>), shared by the server render and the browser. */

export interface Segment {
	value: string;
	label: string;
}

const YEAR = 365 * 86400;
const pad = (n: number) => String(n).padStart(2, "0");

/**
 * Countdown digits, largest unit first. Leading units drop out as the unlock time nears (4 groups, then 3, then 2),
 * so the digits grow as it gets close. Rounds up, so it reads 00:01 until the unlock time is actually reached.
 */
export function countdownSegments(secondsLeft: number): Segment[] {
	const s = Math.max(0, Math.ceil(secondsLeft));
	const years = Math.floor(s / YEAR);
	const days = Math.floor((s % YEAR) / 86400);
	const hours = Math.floor((s % 86400) / 3600);
	const minutes = Math.floor((s % 3600) / 60);
	const seconds = s % 60;
	const y = { value: String(years), label: years === 1 ? "year" : "years" };
	const d = { value: pad(days), label: days === 1 ? "day" : "days" };
	const h = { value: pad(hours), label: hours === 1 ? "hour" : "hours" };
	const m = { value: pad(minutes), label: "min" };
	const sec = { value: pad(seconds), label: "sec" };
	if (years > 0) return [y, d, h, m];
	if (days > 0) return [d, h, m, sec];
	if (hours > 0) return [h, m, sec];
	return [m, sec];
}

/**
 * Markup for the big timer. `--k` is the row's width in ems (digits plus gaps), so CSS can size the digits to fill the
 * available width on any screen: font-size = container width / k.
 */
export function timerHtml(segments: Segment[]): string {
	const chars = segments.reduce((n, s) => n + s.value.length, 0);
	const k = chars * 0.62 + (segments.length - 1) * 0.34;
	const groups = segments
		.map((s) => `<span class="timer-seg"><span class="timer-num">${s.value}</span><span class="timer-label">${s.label}</span></span>`)
		.join("");
	return `<span class="timer-row" style="--k:${k.toFixed(2)}">${groups}</span>`;
}

/** How far through the lock we are, 0 to 1. */
export function lockProgress(createdAt: number, unlockAt: number, now: number): number {
	const total = unlockAt - createdAt;
	if (total <= 0) return 1;
	return Math.min(1, Math.max(0, (now - createdAt) / total));
}

/** "Nov 21, 2026, 2:08 PM UTC" */
export function formatUtcShort(ms: number): string {
	const text = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "UTC" }).format(ms);
	return `${text.replace(/ /g, " ")} UTC`;
}

/** "Sealed 7 days before it could be read." */
export function sealedAheadText(createdAt: number, unlockAt: number): string {
	const seconds = Math.round((unlockAt - createdAt) / 1000);
	return seconds > 0 ? `Sealed ${formatSpan(seconds)} before it could be read.` : "";
}

/** Page title and description. These show in link previews, so they never contain anything but times. */
export function messageMeta(m: { createdAt: number; unlockAt: number }, now: number): { title: string; description: string } {
	if (m.unlockAt > now) {
		return {
			title: `Locked message · opens ${formatUtcShort(m.unlockAt)} · timelock.dev`,
			description: `This message is sealed with timelock encryption. Nobody can read it before ${formatUtcShort(m.unlockAt)}, not even the person who wrote it.`,
		};
	}
	return {
		title: `Unlocked message · sealed ${formatUtcShort(m.createdAt)} · timelock.dev`,
		description: `Sealed on ${formatUtcShort(m.createdAt)} and locked until ${formatUtcShort(m.unlockAt)}. Open the link to read it.`,
	};
}
