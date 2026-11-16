import type { APIRoute } from "astro";
import { getMessageJson } from "../../../../lib/api";
import { methodNotAllowed } from "../../../../lib/http";
import { deps } from "../../../../lib/server";

export const prerender = false;
export const GET: APIRoute = (ctx) => getMessageJson(ctx.url, ctx.params.id, deps(ctx));
export const ALL = methodNotAllowed("GET");
