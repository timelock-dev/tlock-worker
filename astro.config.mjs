// @ts-check
import cloudflare from "@astrojs/cloudflare";
import { defineConfig } from "astro/config";

export default defineConfig({
	site: "https://timelock.dev",
	adapter: cloudflare({ imageService: "passthrough" }),
	session: false,
	// Compression drops whitespace that contains a newline next to an {expression}, gluing words to values ("since2023").
	compressHTML: false,
	build: { format: "file" },
	devToolbar: { enabled: false },
	server: { port: 4327, host: true },
});
