import { iconSvg } from "./icons";
import { formatApproxDuration, formatDuration, formatFriendly, formatRelative, formatUtc } from "./time";

const roundLabel = (round: number) => `drand round #${round.toLocaleString("en-US")}`;

function panel(tone: "done" | "locked" | "open", headline: string, lines: { text: string; muted?: boolean }[]): string {
	const body = lines.map((l) => `<p class="lock-panel-line${l.muted ? " muted" : ""}">${l.text}</p>`).join("");
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

/** Shown in Decrypt once a pasted message has been read. */
export function decryptStatePanelHtml(unlockAt: number, round: number, now: number): string {
	const left = (unlockAt - now) / 1000;
	if (left > 0) {
		return panel("locked", "Still locked", [
			{ text: `Opens ${formatFriendly(unlockAt)}` },
			{ text: formatUtc(unlockAt), muted: true },
			{ text: `${formatDuration(left)} to go` },
			{ text: roundLabel(round), muted: true },
		]);
	}
	return panel("open", "Ready to decrypt", [
		{ text: `Unlocked ${formatFriendly(unlockAt)} (${formatRelative(unlockAt, now)})` },
		{ text: `${formatUtc(unlockAt)} · ${roundLabel(round)}`, muted: true },
	]);
}
