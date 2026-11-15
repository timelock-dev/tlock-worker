import { createDrandClient, currentRound, DrandUnavailableError } from "../lib/drand";
import { countdownSegments, lockProgress, timerHtml } from "../lib/message-view";
import { formatCountdown, formatFriendly, formatSpan } from "../lib/time";

const OPENED_KEY = "timelock:opened";
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function copyText(text: string): Promise<boolean> {
	try {
		await navigator.clipboard.writeText(text);
		return true;
	} catch {
		return false;
	}
}

function download(name: string, data: BlobPart, type: string) {
	const a = document.createElement("a");
	a.href = URL.createObjectURL(new Blob([data], { type }));
	a.download = name;
	a.click();
	URL.revokeObjectURL(a.href);
}

/** Tells the server this browser decrypted the message, once per tab. Sends the id only, never the message. */
function reportOpened(id: string) {
	let seen: string[] = [];
	try {
		const list = JSON.parse(sessionStorage.getItem(OPENED_KEY) ?? "[]");
		if (Array.isArray(list)) seen = list;
	} catch {
		/* storage blocked: report anyway */
	}
	if (seen.includes(id)) return;
	try {
		sessionStorage.setItem(OPENED_KEY, JSON.stringify([...seen, id].slice(-200)));
	} catch {
		/* ignore */
	}
	fetch(`/api/messages/${id}/opened`, { method: "POST", keepalive: true }).catch(() => {});
}

/** Runs the hosted message page: live countdown while locked, then decrypts in the browser at the unlock time. */
export function startMessagePage(root: HTMLElement): void {
	const $ = <T extends HTMLElement>(sel: string) => root.querySelector<T>(sel)!;
	const id = root.dataset.id!;
	const unlockAt = Number(root.dataset.unlockAt);
	const createdAt = Number(root.dataset.createdAt);
	const round = Number(root.dataset.round);
	// Count down on the server's clock, so a wrong device clock can't show the wrong time left.
	const skew = Number(root.dataset.serverNow) - Date.now();
	const now = () => Date.now() + (Number.isFinite(skew) ? skew : 0);

	const ciphertext = $<HTMLTextAreaElement>("[data-ciphertext]").value;
	const timer = $("[data-timer]");
	const progress = $("[data-progress]");
	const rounds = $("[data-rounds]");
	const status = $("[data-status]");
	const plaintextBox = $("[data-plaintext]");
	let state: "locked" | "opening" | "open" | "failed" = "locked";
	let shownTimer = "";
	let plaintext: Uint8Array | null = null;

	for (const el of root.querySelectorAll<HTMLTimeElement>("time[data-local]")) {
		const ms = Date.parse(el.dateTime);
		if (Number.isFinite(ms)) el.textContent = formatFriendly(ms);
	}

	function tick() {
		if (state !== "locked") return;
		const t = now();
		const left = (unlockAt - t) / 1000;
		if (left <= 0) {
			void open();
			return;
		}
		const html = timerHtml(countdownSegments(left));
		if (html !== shownTimer) timer.innerHTML = shownTimer = html;
		timer.setAttribute("aria-label", `${formatSpan(left)} left`);
		progress.style.width = `${(lockProgress(createdAt, unlockAt, t) * 100).toFixed(2)}%`;
		const roundsLeft = Math.max(0, round - currentRound(t));
		rounds.textContent = `drand round #${round.toLocaleString("en-US")} · ${roundsLeft.toLocaleString("en-US")} ${roundsLeft === 1 ? "round" : "rounds"} to go`;
		document.title = `${formatCountdown(Math.ceil(left))} · Locked message · timelock.dev`;
	}

	function show(bytes: Uint8Array) {
		plaintext = bytes;
		let text: string | null;
		try {
			text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
		} catch {
			text = null;
		}
		if (text === null) {
			plaintextBox.textContent = `This is a file, not text (${bytes.byteLength.toLocaleString("en-US")} bytes).`;
			plaintextBox.dataset.size = "md";
			$("[data-download-message]").hidden = false;
		} else {
			// textContent only: the message is untrusted and must never be parsed as HTML.
			plaintextBox.textContent = text || "(empty message)";
			plaintextBox.dataset.size = text.length <= 120 ? "xl" : text.length <= 600 ? "lg" : "md";
			$("[data-copy-message]").hidden = false;
		}
		$("[data-reveal]").hidden = false;
		status.hidden = true;
		state = "open";
		root.dataset.state = "open";
	}

	async function open() {
		state = "opening";
		root.dataset.state = "opening";
		$("[data-locked]").hidden = true;
		$("[data-open]").hidden = false;
		$("[data-pill-locked]").hidden = true;
		$("[data-pill-open]").hidden = false;
		document.title = "Unlocked message · timelock.dev";
		status.hidden = false;
		status.textContent = "Getting the key from drand…";
		try {
			const { decrypt, TooEarlyError } = await import("../lib/tlock");
			const client = createDrandClient();
			for (let attempt = 0; ; attempt++) {
				try {
					show((await decrypt(ciphertext, client, Math.max(now(), unlockAt))).plaintext);
					reportOpened(id);
					return;
				} catch (err) {
					// drand publishes the round a moment after its scheduled time, so the first try can be early.
					if (!(err instanceof TooEarlyError || err instanceof DrandUnavailableError)) throw err;
					status.textContent = attempt < 3 ? "Waiting for drand to publish the key…" : "Still waiting for drand. This page keeps trying.";
					await sleep(Math.min(1000 * 2 ** attempt, 15_000));
				}
			}
		} catch (err) {
			state = "failed";
			root.dataset.state = "failed";
			status.classList.add("is-error");
			status.textContent = `Could not decrypt in this browser: ${err instanceof Error ? err.message : String(err)} The encrypted text below still works in any tlock tool.`;
		}
	}

	async function flash(button: HTMLElement, ok: boolean) {
		const label = button.textContent;
		button.textContent = ok ? "Copied" : "Copy failed";
		await sleep(1500);
		button.textContent = label;
	}
	const onClick = (sel: string, fn: (button: HTMLElement) => void) => {
		const el = root.querySelector<HTMLElement>(sel);
		el?.addEventListener("click", () => fn(el));
	};

	onClick("[data-copy-link]", async (b) => flash(b, await copyText(location.href)));
	onClick("[data-copy-message]", async (b) => flash(b, await copyText(plaintextBox.textContent ?? "")));
	onClick("[data-copy-cipher]", async (b) => flash(b, await copyText(ciphertext)));
	onClick("[data-download-cipher]", () => download(`timelock-${id.slice(0, 8)}.age`, ciphertext, "text/plain"));
	onClick("[data-download-message]", () => {
		if (plaintext) download("timelock-decrypted.bin", plaintext as BlobPart, "application/octet-stream");
	});
	if (typeof navigator.share === "function") {
		const share = $("[data-share]");
		share.hidden = false;
		share.addEventListener("click", () => {
			const text = state === "locked" ? `A message locked until ${formatFriendly(unlockAt)}.` : "A timelocked message, now unlocked.";
			navigator.share({ title: "timelock.dev", text, url: location.href }).catch(() => {});
		});
	}

	tick();
	setInterval(tick, 250);
}
