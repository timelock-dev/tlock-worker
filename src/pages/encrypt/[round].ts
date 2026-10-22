import type { APIRoute } from "astro";
import { legacyEncrypt } from "../../lib/api";
import { methodNotAllowed } from "../../lib/http";
import { deps } from "../../lib/server";

export const prerender = false;
export const POST: APIRoute = (ctx) => legacyEncrypt(ctx.request, ctx.params.round, deps(ctx));
export const ALL = methodNotAllowed("POST");
