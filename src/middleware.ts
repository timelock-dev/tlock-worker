import { defineMiddleware } from "astro:middleware";
import { CORS_HEADERS, isApiPath } from "./lib/http";

export const onRequest = defineMiddleware(async (context, next) => {
	if (context.isPrerendered || !isApiPath(context.url.pathname)) return next();
	if (context.request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });
	const response = await next();
	for (const [k, v] of Object.entries(CORS_HEADERS)) response.headers.set(k, v);
	return response;
});
