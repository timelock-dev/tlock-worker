import { env } from "cloudflare:workers";
import type { APIContext } from "astro";
import type { Deps } from "./api";
import { createDrandClient } from "./drand";

const drand = createDrandClient();

export function deps(context: APIContext): Deps {
	return {
		drand,
		db: env.DB,
		waitUntil: (p) => context.locals.cfContext.waitUntil(p),
	};
}
