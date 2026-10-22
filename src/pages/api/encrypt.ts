import type { APIRoute } from "astro";
import { apiEncrypt } from "../../lib/api";
import { methodNotAllowed } from "../../lib/http";
import { deps } from "../../lib/server";

export const prerender = false;
export const POST: APIRoute = (ctx) => apiEncrypt(ctx.request, deps(ctx));
export const ALL = methodNotAllowed("POST");
