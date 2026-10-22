// @ts-check
import cloudflare from "@astrojs/cloudflare";
import { defineConfig } from "astro/config";

export default defineConfig({
	site: "https://timelock.dev",
	adapter: cloudflare({ imageService: "passthrough" }),
	session: false,
	devToolbar: { enabled: false },
	server: { port: 4327, host: true },
});
