import type { APIRoute } from "astro";
import { legacyDecrypt } from "../lib/api";
import { deps } from "../lib/server";

export const prerender = false;
export const POST: APIRoute = (ctx) => legacyDecrypt(ctx.request, deps(ctx));
export const GET: APIRoute = (ctx) => ctx.redirect("/#decrypt", 302);
