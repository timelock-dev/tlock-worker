import { iconSvg } from "../lib/icons";
import { formatLocal } from "../lib/time";
import { verifyDrand, type RelayCheck, type Verification } from "../lib/verify";

const RECHECK_MS = 60_000;

const ago = (ms: number) => {
	const s = Math.max(0, Math.round(ms / 1000));
	return s < 2 ? "just now" : s < 60 ? `${s}s ago` : s < 3600 ? `${Math.floor(s / 60)} min ago` : `${Math.floor(s / 3600)} h ago`;
};
const host = (relay: string) => new URL(relay).host;
const mark = (ok: boolean, label: string) => `<span class="${ok ? "ok" : "bad"}">${ok ? "✓" : "✗"} ${label}</span>`;

function relayHtml(r: RelayCheck): string {
	const round = `round ${r.round?.toLocaleString("en-US") ?? "?"}`;
	const unreachable = r.round === null && !r.chainHashOk;
	const detail = unreachable ? (r.error ?? "") : [mark(r.chainHashOk, "chain hash"), mark(r.publicKeyOk, "public key"), mark(r.signatureOk, "signature"), mark(r.roundOk, round)].join(" ");
	return `<li><strong>${host(r.relay)}</strong> <span class="${r.ok ? "ok" : "bad"}">${r.ok ? "passed" : "failed"}</span><br><span class="small">${detail}</span></li>`;
}

export function startVerifyBadge(): void {
	const found = document.querySelector<HTMLDetailsElement>("[data-verify]");
	if (!found) return;
	const root = found;
	const $ = (sel: string) => root.querySelector<HTMLElement>(sel)!;
	let last: Verification | null = null;
	root.hidden = false;

	function renderBadge() {
		if (!last) return;
		const passed = last.relays.filter((r) => r.ok).length;
		const text = $("[data-verify-text]");
		if (last.status === "verified") {
			text.innerHTML = `<span class="verify-long">drand quicknet </span>verified<span class="verify-mid"> · round #${last.round!.toLocaleString("en-US")}</span><span class="verify-long"> · ${ago(Date.now() - last.checkedAt)}</span>`;
		} else if (last.status === "warning") {
			text.innerHTML = `drand: ${passed} of ${last.relays.length} relays<span class="verify-mid"> passed</span>`;
		} else {
			text.textContent = "drand check failed";
		}
	}

	function render(v: Verification) {
		last = v;
		root.dataset.state = v.status;
		$("[data-verify-icon]").innerHTML = iconSvg(v.status === "verified" ? "check" : "alert");
		const passed = v.relays.filter((r) => r.ok);
		$("[data-verify-headline]").textContent =
			v.status === "verified"
				? `Verified at ${formatLocal(v.checkedAt)}`
				: v.status === "warning"
					? "One relay failed the check. The others passed, and the site still works."
					: "No relay passed the check. Encrypting still works; decrypting needs drand.";
		$("[data-verify-round]").textContent = v.round
			? `#${v.round.toLocaleString("en-US")} (expected about #${v.relays[0].expectedRound.toLocaleString("en-US")} for the current time)`
			: "—";
		$("[data-verify-signature]").textContent = passed.length
			? `BLS signature valid under the pinned public key on ${passed.length} of ${v.relays.length} relays`
			: "Not verified";
		$("[data-verify-relays]").innerHTML = v.relays.map(relayHtml).join("");
		renderBadge();
	}

	async function check() {
		if (document.hidden && last) return;
		render(await verifyDrand());
	}

	check();
	setInterval(renderBadge, 1000);
	setInterval(check, RECHECK_MS);
	document.addEventListener("click", (e) => {
		if (root.open && !root.contains(e.target as Node)) root.open = false;
	});
	document.addEventListener("keydown", (e) => {
		if (e.key === "Escape" && root.open) root.open = false;
	});
}
