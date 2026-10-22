import type { APIRoute } from "astro";
import { getStats } from "../../lib/api";
import { methodNotAllowed } from "../../lib/http";
import { deps } from "../../lib/server";

export const prerender = false;
export const GET: APIRoute = (ctx) => getStats(deps(ctx));
export const ALL = methodNotAllowed("GET");
