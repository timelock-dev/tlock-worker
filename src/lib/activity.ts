import type { EventStats, FeedEvent } from "./events";
import { iconSvg } from "./icons";
import { formatDuration, formatLocal, formatRelative, formatUtc } from "./time";

export const ACTIVITY_LIMIT = 10;

const escape = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const count = (n: number) => n.toLocaleString("en-US");

/** Lock length for display: whole minutes once it's a minute or more, so the 3-second round snap doesn't show as "and 2 seconds". */
export function lockLength(seconds: number): string {
	const s = Math.max(0, seconds);
	return formatDuration(s >= 60 ? Math.round(s / 60) * 60 : s, 2);
}

type StatsPart = { text: string; strong?: boolean; group?: boolean };

/** Sentence parts; `strong` parts are the numbers, and consecutive `group` parts should not wrap apart. */
export function statsParts(stats: EventStats): StatsPart[] {
	const window = `in the last ${stats.days} days.`;
	if (stats.encrypted === 0 && stats.decrypted === 0) return [{ text: `No messages encrypted or decrypted ${window}` }];
	const parts: StatsPart[] = [
		{ text: count(stats.encrypted), strong: true },
		{ text: ` ${stats.encrypted === 1 ? "message" : "messages"} encrypted and ` },
		{ text: count(stats.decrypted), strong: true },
		{ text: ` decrypted ${window}` },
	];
	if (stats.averageLockSeconds !== null) {
		parts.push({ text: " " }, { text: "Average lock: ", group: true }, { text: lockLength(stats.averageLockSeconds), strong: true, group: true }, { text: ".", group: true });
	}
	return parts;
}

export function statsText(stats: EventStats): string {
	return statsParts(stats)
		.map((p) => p.text)
		.join("");
}

export function statsHtml(stats: EventStats): string {
	const html = (p: StatsPart) => (p.strong ? `<strong>${escape(p.text)}</strong>` : escape(p.text));
	const parts = statsParts(stats);
	const group = parts.filter((p) => p.group);
	return (
		parts
			.filter((p) => !p.group)
			.map(html)
			.join("") + (group.length ? `<span class="nowrap">${group.map(html).join("")}</span>` : "")
	);
}

/** The muted detail after "Encrypted"/"Decrypted", e.g. "for 3 hours · unlocks in 2 hours". */
export function eventDetail(e: FeedEvent, now: number): string {
	const created = Date.parse(e.createdAt);
	const unlock = Date.parse(e.unlockAt);
	const when = unlock > now ? `unlocks ${formatRelative(unlock, now)}` : `unlocked ${formatRelative(unlock, now)}`;
	if (e.type === "decrypt") return when;
	return `for ${lockLength((unlock - created) / 1000)} · ${when}`;
}

/** `timeZone` is for the hover title; the server passes "UTC", the browser leaves it unset for local time. */
export function eventRowHtml(e: FeedEvent, now: number, timeZone?: string): string {
	const created = Date.parse(e.createdAt);
	const unlock = Date.parse(e.unlockAt);
	const encrypted = e.type === "encrypt";
	const tooltip = `Unlock time ${formatUtc(unlock)}, drand round #${count(e.round)}`;
	return `<li class="activity-row">
	<span class="activity-icon ${encrypted ? "is-lock" : "is-unlock"}">${iconSvg(encrypted ? "lock" : "unlock")}</span>
	<span class="activity-main" title="${escape(tooltip)}"><strong>${encrypted ? "Encrypted" : "Decrypted"}</strong> <span class="muted">${escape(eventDetail(e, now))}</span></span>
	<span class="Label">${e.source === "web" ? "website" : "API"}</span>
	<time class="activity-time muted" datetime="${escape(e.createdAt)}" title="${escape(formatLocal(created, { timeZone }))}">${escape(formatRelative(created, now))}</time>
</li>`;
}

export function activityRowsHtml(events: FeedEvent[], now: number, timeZone?: string): string {
	return events.map((e) => eventRowHtml(e, now, timeZone)).join("\n");
}
