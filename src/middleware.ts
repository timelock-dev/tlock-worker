import { defineMiddleware } from "astro:middleware";
import { CORS_HEADERS, UNLISTED_HEADERS, isApiPath, isUnlistedPath } from "./lib/http";

export const onRequest = defineMiddleware(async (context, next) => {
	const { pathname } = context.url;
	const api = isApiPath(pathname);
	const unlisted = isUnlistedPath(pathname);
	if (context.isPrerendered || (!api && !unlisted)) return next();
	if (api && context.request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });
	const response = await next();
	if (api) for (const [k, v] of Object.entries(CORS_HEADERS)) response.headers.set(k, v);
	// Set here, not per route, so no hosted-message response can forget noindex and no-referrer.
	if (unlisted) for (const [k, v] of Object.entries(UNLISTED_HEADERS)) response.headers.set(k, v);
	return response;
});
