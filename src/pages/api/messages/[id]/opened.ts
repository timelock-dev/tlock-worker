import type { APIRoute } from "astro";
import { postMessageOpened } from "../../../../lib/api";
import { methodNotAllowed } from "../../../../lib/http";
import { deps } from "../../../../lib/server";

export const prerender = false;
export const POST: APIRoute = (ctx) => postMessageOpened(ctx.request, ctx.params.id, deps(ctx));
export const ALL = methodNotAllowed("POST");
