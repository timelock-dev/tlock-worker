// Scans rendered pages for words glued to numbers or to inline elements ("since2023", "up to<code>100</code>").
// Usage: node scripts/check-html.mjs [base URL], against a running `npm run preview`.
const base = process.argv[2] ?? "http://127.0.0.1:4328";
const pages = ["/", "/docs", "/how-it-works", "/no-such-page"];
// Technical names that legitimately end in digits.
const allowed = /^(BLS12|ChaCha20|Poly1305|G1|utf8|base64|RFC9380|v1|sha256)$/i;
const inline = "a|code|strong|em|time|kbd";

let problems = 0;
for (const path of pages) {
	const html = await (await fetch(new URL(path, base))).text();
	const body = html
		.replace(/<!--[\s\S]*?-->/g, "")
		.replace(/<(script|style|pre|textarea|svg|head)\b[\s\S]*?<\/\1>/gi, " ");
	const report = (what, at) => {
		problems++;
		const i = body.indexOf(at);
		console.log(`${path}: ${what}: …${body.slice(Math.max(0, i - 40), i + at.length + 40).replace(/\s+/g, " ")}…`);
	};
	for (const m of body.matchAll(new RegExp(`[A-Za-z0-9]<(${inline})[\\s>]`, "g"))) report("word glued to an opening tag", m[0]);
	for (const m of body.matchAll(new RegExp(`</(${inline})>[A-Za-z0-9]`, "g"))) report("closing tag glued to a word", m[0]);
	for (const text of body.replace(/<code\b[^>]*>[^<]*<\/code>/g, "<code></code>").matchAll(/>([^<]+)</g)) {
		for (const m of text[1].matchAll(/\b[A-Za-z]{2,}\d+\b/g)) if (!allowed.test(m[0])) report("word glued to a number", m[0]);
	}
	console.log(`${path}: checked ${html.length.toLocaleString("en-US")} bytes`);
}
if (problems) {
	console.error(`${problems} spacing problem(s) found.`);
	process.exit(1);
}
console.log("No glued words found.");
