import { defineMiddleware } from "astro:middleware";
import { CORS_HEADERS, isApiPath, messageHeaders } from "./lib/http";

export const onRequest = defineMiddleware(async (context, next) => {
	const { pathname } = context.url;
	const api = isApiPath(pathname);
	const extra = messageHeaders(pathname);
	if (context.isPrerendered || (!api && !extra)) return next();
	if (api && context.request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });
	const response = await next();
	if (api) for (const [k, v] of Object.entries(CORS_HEADERS)) response.headers.set(k, v);
	// Set here, not per route, so no hosted-message response can forget no-referrer and no-store.
	if (extra) for (const [k, v] of Object.entries(extra)) response.headers.set(k, v);
	return response;
});
