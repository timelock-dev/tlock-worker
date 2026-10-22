export const CORS_HEADERS: Record<string, string> = {
	"Access-Control-Allow-Origin": "*",
	"Access-Control-Allow-Methods": "GET, POST, OPTIONS",
	"Access-Control-Allow-Headers": "*",
	"Access-Control-Max-Age": "86400",
};

/** Paths served by the Worker that third parties may call cross-origin (JSON API + legacy endpoints). */
export function isApiPath(pathname: string): boolean {
	return pathname.startsWith("/api/") || pathname.startsWith("/encrypt/") || pathname === "/decrypt";
}

export type ErrorCode =
	| "invalid_json"
	| "invalid_request"
	| "method_not_allowed"
	| "payload_too_large"
	| "invalid_ciphertext"
	| "unsupported_chain"
	| "too_early"
	| "forbidden"
	| "drand_unavailable"
	| "feed_unavailable"
	| "internal_error";

export class ApiError extends Error {
	constructor(
		readonly status: number,
		readonly code: ErrorCode,
		message: string,
		readonly details: Record<string, unknown> = {},
	) {
		super(message);
	}
}

export function json(body: unknown, init: ResponseInit = {}): Response {
	const headers = new Headers(init.headers);
	headers.set("Content-Type", "application/json; charset=utf-8");
	return new Response(JSON.stringify(body, null, 2) + "\n", { ...init, headers });
}

export function errorJson(err: ApiError): Response {
	return json({ error: { code: err.code, message: err.message, ...err.details } }, { status: err.status });
}

export function errorText(err: ApiError): Response {
	return new Response(err.message + "\n", { status: err.status, headers: { "Content-Type": "text/plain; charset=utf-8" } });
}

export const methodNotAllowed = (allow: string) => () =>
	errorJson(new ApiError(405, "method_not_allowed", `Use ${allow}.`));

/** Reads the request body, rejecting anything larger than `maxBytes` (checked before and after reading). */
export async function readBody(request: Request, maxBytes: number): Promise<Uint8Array> {
	const declared = Number(request.headers.get("Content-Length") ?? 0);
	const tooLarge = () => new ApiError(413, "payload_too_large", `Request body exceeds the ${maxBytes.toLocaleString("en-US")} byte limit.`, { limitBytes: maxBytes });
	if (declared > maxBytes) throw tooLarge();
	const body = new Uint8Array(await request.arrayBuffer());
	if (body.byteLength > maxBytes) throw tooLarge();
	return body;
}

export async function readJson(request: Request, maxBytes: number): Promise<Record<string, unknown>> {
	const body = await readBody(request, maxBytes);
	let parsed: unknown;
	try {
		parsed = JSON.parse(new TextDecoder().decode(body));
	} catch {
		throw new ApiError(400, "invalid_json", "Request body must be a JSON object.");
	}
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		throw new ApiError(400, "invalid_json", "Request body must be a JSON object.");
	}
	return parsed as Record<string, unknown>;
}
