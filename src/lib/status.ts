import { iconSvg } from "./icons";
import { noteUnlockTime } from "./notes";
import { formatApproxDuration, formatDuration, formatFriendly, formatRelative, formatUtc } from "./time";

const roundLabel = (round: number) => `drand round #${round.toLocaleString("en-US")}`;

type Line = { text: string; muted?: boolean; warn?: boolean };

function panel(tone: "done" | "locked" | "open", headline: string, lines: Line[]): string {
	const body = lines.map((l) => `<p class="lock-panel-line${l.muted ? " muted" : ""}${l.warn ? " warn" : ""}">${l.text}</p>`).join("");
	return `<div class="lock-panel is-${tone}"><span class="lock-panel-icon">${iconSvg(tone === "open" ? "unlock" : "lock")}</span><div><p class="lock-panel-headline">${headline}</p>${body}</div></div>`;
}

/** Shown after encrypting. */
export function encryptedPanelHtml(unlockAt: number, round: number, now: number): string {
	const left = (unlockAt - now) / 1000;
	const when = formatFriendly(unlockAt);
	return panel("done", "Your message is encrypted", [
		{ text: left > 0 ? `It can be opened on ${when} (in ${formatApproxDuration(left)}).` : `It can be opened now. It unlocked on ${when}.` },
		{ text: `${formatUtc(unlockAt)} · ${roundLabel(round)}`, muted: true },
	]);
}

function notesLines(unlockAt: number, notes: string[]): Line[] {
	if (!notes.length) return [];
	const claimed = noteUnlockTime(notes);
	const lines: Line[] = [{ text: `${notes.length === 1 ? "1 line" : `${notes.length} lines`} of plain text outside the encrypted block ${notes.length === 1 ? "was" : "were"} ignored.`, muted: true }];
	if (claimed !== null && Math.abs(claimed - unlockAt) >= 1000) {
		lines.push({ text: `The note says ${formatUtc(claimed)}, but the encrypted block says ${formatUtc(unlockAt)}. Notes can be edited by anyone; the block is what counts.`, warn: true });
	}
	return lines;
}

/** Shown in Decrypt once a pasted message has been read. `notes` are the lines found outside the BEGIN…END block. */
export function decryptStatePanelHtml(unlockAt: number, round: number, now: number, notes: string[] = []): string {
	const left = (unlockAt - now) / 1000;
	if (left > 0) {
		return panel("locked", "Still locked", [
			{ text: `Opens ${formatFriendly(unlockAt)}` },
			{ text: formatUtc(unlockAt), muted: true },
			{ text: `${formatDuration(left)} to go` },
			{ text: roundLabel(round), muted: true },
			...notesLines(unlockAt, notes),
		]);
	}
	return panel("open", "Ready to decrypt", [
		{ text: `Unlocked ${formatFriendly(unlockAt)} (${formatRelative(unlockAt, now)})` },
		{ text: `${formatUtc(unlockAt)} · ${roundLabel(round)}`, muted: true },
		...notesLines(unlockAt, notes),
	]);
}
