import { formatFriendly, formatUtc } from "./time";

export const SITE_URL = "https://timelock.dev";

export interface NoteOptions {
	/** Adds "Unlock at https://timelock.dev". */
	instructions: boolean;
	/** Adds "Unlocks: <local time> (<UTC time>)". */
	unlockTime: boolean;
	/** IANA zone for the local time. Defaults to the runtime's zone. */
	timeZone?: string;
}

const UNLOCKS_PREFIX = "Unlocks: ";
const UTC_IN_NOTE = /\((\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2}) UTC\)\s*$/;

/** Plain lines placed above the armored block. They are not encrypted or signed. */
export function noteLines(unlockAt: number, opts: NoteOptions): string[] {
	const lines: string[] = [];
	if (opts.instructions) lines.push(`Unlock at ${SITE_URL}`);
	if (opts.unlockTime) {
		const local = formatFriendly(unlockAt, { timeZone: opts.timeZone }).replace(" at ", " ");
		lines.push(`${UNLOCKS_PREFIX}${local} (${formatUtc(unlockAt)})`);
	}
	return lines;
}

/** Notes, a blank line, then the block, so the block alone stays easy to select. */
export function withNotes(armored: string, lines: string[]): string {
	return lines.length ? `${lines.join("\n")}\n\n${armored}` : armored;
}

/** The UTC time an "Unlocks:" note claims, or null if there isn't one. */
export function noteUnlockTime(notes: string[]): number | null {
	for (const line of notes) {
		if (!line.startsWith(UNLOCKS_PREFIX)) continue;
		const m = UTC_IN_NOTE.exec(line);
		if (m) return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
	}
	return null;
}
