import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { roundTime } from "../src/lib/drand";
import { noteLines, noteUnlockTime, withNotes } from "../src/lib/notes";
import { decryptStatePanelHtml } from "../src/lib/status";
import { formatUtc } from "../src/lib/time";
import { extractArmor, inspectCiphertext, InvalidCiphertextError } from "../src/lib/tlock";

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url));
const ARMORED = fixture("rust-tlock-age-0.0.5.age").toString("utf8");
const ROUND = inspectCiphertext(ARMORED).round;
const UNLOCK = roundTime(ROUND);
const NOV_21 = Date.UTC(2026, 10, 21, 14, 8, 27);

describe("note lines", () => {
	it("formats instructions and a local plus UTC unlock time", () => {
		expect(noteLines(NOV_21, { instructions: true, unlockTime: true, timeZone: "America/New_York" })).toEqual([
			"Unlock at https://timelock.dev",
			"Unlocks: Sat, Nov 21, 2026 9:08 AM EST (2026-11-21 14:08:27 UTC)",
		]);
	});

	it("includes only what is asked for", () => {
		expect(noteLines(NOV_21, { instructions: false, unlockTime: true, timeZone: "UTC" })).toEqual(["Unlocks: Sat, Nov 21, 2026 2:08 PM UTC (2026-11-21 14:08:27 UTC)"]);
		expect(noteLines(NOV_21, { instructions: true, unlockTime: false })).toEqual(["Unlock at https://timelock.dev"]);
		expect(noteLines(NOV_21, { instructions: false, unlockTime: false })).toEqual([]);
	});

	it("puts a blank line between the notes and the block, and nothing when there are no notes", () => {
		expect(withNotes(ARMORED, ["a", "b"])).toBe(`a\nb\n\n${ARMORED}`);
		expect(withNotes(ARMORED, [])).toBe(ARMORED);
	});

	it("reads back the UTC time an Unlocks note claims", () => {
		expect(noteUnlockTime(noteLines(NOV_21, { instructions: true, unlockTime: true, timeZone: "Asia/Tokyo" }))).toBe(NOV_21);
		expect(noteUnlockTime(["Unlock at https://timelock.dev"])).toBeNull();
		expect(noteUnlockTime(["Unlocks: soon"])).toBeNull();
	});
});

describe("extractArmor", () => {
	it("passes a bare block through unchanged", () => {
		expect(extractArmor(ARMORED)).toEqual({ block: ARMORED, notes: [] });
	});

	it("finds the block under notes and over trailing text", () => {
		const text = `Unlock at https://timelock.dev\nUnlocks: x\n\n${ARMORED}\nsigned, Alan\n`;
		expect(extractArmor(text)).toEqual({ block: ARMORED, notes: ["Unlock at https://timelock.dev", "Unlocks: x", "signed, Alan"] });
	});

	it("normalizes Windows line endings", () => {
		expect(extractArmor(`note\r\n\r\n${ARMORED.replace(/\n/g, "\r\n")}`)).toEqual({ block: ARMORED, notes: ["note"] });
	});

	it("leaves binary age and text without a block alone", () => {
		expect(extractArmor("age-encryption.org/v1\n-> tlock 1 abc\n")).toBeNull();
		expect(extractArmor("hello")).toBeNull();
	});

	it("rejects a block with no END line, and two blocks", () => {
		expect(() => extractArmor(`note\n${ARMORED.split("-----END")[0]}`)).toThrow(InvalidCiphertextError);
		expect(() => extractArmor(`${ARMORED}${ARMORED}`)).toThrow(/more than one encrypted block/);
	});

	it("lets inspectCiphertext read the round through notes", () => {
		const info = inspectCiphertext(withNotes(ARMORED, noteLines(UNLOCK, { instructions: true, unlockTime: true })));
		expect(info).toMatchObject({ round: ROUND, armored: true });
		expect(info.notes).toHaveLength(2);
	});
});

describe("decrypt panel with notes", () => {
	const notes = noteLines(UNLOCK, { instructions: true, unlockTime: true });

	it("says how many lines were ignored", () => {
		const html = decryptStatePanelHtml(UNLOCK, ROUND, UNLOCK + 1000, notes);
		expect(html).toContain("2 lines of plain text outside the encrypted block were ignored.");
		expect(html).not.toContain("warn");
	});

	it("warns when the note's time doesn't match the block", () => {
		const forged = noteLines(UNLOCK - 86_400_000, { instructions: false, unlockTime: true });
		const html = decryptStatePanelHtml(UNLOCK, ROUND, UNLOCK - 5000, forged);
		expect(html).toContain("1 line of plain text outside the encrypted block was ignored.");
		expect(html).toContain(`The note says ${formatUtc(UNLOCK - 86_400_000)}, but the encrypted block says ${formatUtc(UNLOCK)}.`);
	});

	it("never puts note text into the page", () => {
		const html = decryptStatePanelHtml(UNLOCK, ROUND, UNLOCK + 1000, ["<img src=x onerror=alert(1)>"]);
		expect(html).not.toContain("<img");
	});
});
