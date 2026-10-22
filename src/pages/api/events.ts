import type { APIRoute } from "astro";
import { getEvents, postEvent } from "../../lib/api";
import { methodNotAllowed } from "../../lib/http";
import { deps } from "../../lib/server";

export const prerender = false;
export const GET: APIRoute = (ctx) => getEvents(ctx.url, deps(ctx));
export const POST: APIRoute = (ctx) => postEvent(ctx.request, deps(ctx));
export const ALL = methodNotAllowed("GET or POST");
