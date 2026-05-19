import { mkdir, writeFile, appendFile } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import { Type } from "typebox";
import { xaiOAuthProvider, type OAuthCredentials, type OAuthLoginCallbacks } from "./xai-oauth.js";

export { loginXaiOAuth, parseXaiAuthorizationInput, refreshXaiOAuthToken, xaiOAuthProvider } from "./xai-oauth.js";
export type { OAuthCredentials, OAuthLoginCallbacks, OAuthProviderInterface } from "./xai-oauth.js";

export const DEFAULT_X_SEARCH_MODEL = "grok-4.3";
export const DEFAULT_XAI_BASE_URL = "https://api.x.ai/v1";
export const DEFAULT_TIMEOUT_MS = 180_000;
export const DEFAULT_RETRIES = 2;
export const MAX_HANDLES = 10;
export const DEFAULT_DEEP_CHUNK_SIZE = 900;
export const DEFAULT_DEEP_MAX_CHUNKS = 12;
export const DEFAULT_DEEP_OVERLAP_CHARS = 0;
export const MIN_DEEP_CHUNK_SIZE = 200;
export const MAX_DEEP_CHUNK_SIZE = 2_000;
export const MAX_DEEP_MAX_CHUNKS = 50;
export const MAX_DEEP_OVERLAP_CHARS = 200;
export const DEFAULT_DEEP_OUTPUT_MODE = "file";

export type CredentialSource = "xai-oauth" | "xai";
export type XSearchToolName = "x_search" | "x_search_deep";
export type XSearchDeepOutputMode = "inline" | "file";

export type XSearchParams = {
	query: string;
	allowed_x_handles?: string[];
	excluded_x_handles?: string[];
	from_date?: string;
	to_date?: string;
	enable_image_understanding?: boolean;
	enable_video_understanding?: boolean;
	return_full_text?: boolean;
};

export type XSearchDeepParams = XSearchParams & {
	chunk_size?: number;
	max_chunks?: number;
	overlap_chars?: number;
	output_mode?: XSearchDeepOutputMode;
	output_path?: string;
};

export type XSearchToolDefinition = {
	type: "x_search";
	allowed_x_handles?: string[];
	excluded_x_handles?: string[];
	from_date?: string;
	to_date?: string;
	enable_image_understanding?: true;
	enable_video_understanding?: true;
	return_full_text?: true;
};

export type XSearchRequestPayload = {
	model: string;
	input: Array<{ role: "user"; content: string }>;
	tools: [XSearchToolDefinition];
	store: false;
};

export type InlineCitation = {
	title?: string;
	url?: string;
	start_index?: number;
	end_index?: number;
};

export type XSearchSuccess = {
	success: true;
	provider: "xai";
	credential_source: CredentialSource;
	tool: "x_search";
	model: string;
	query: string;
	response_id?: string;
	answer: string;
	citations: unknown[];
	inline_citations: InlineCitation[];
};

export type XSearchFailure = {
	success: false;
	provider: "xai";
	credential_source?: CredentialSource;
	tool: XSearchToolName;
	model?: string;
	query?: string;
	error: string;
	error_type: string;
	status?: number;
};

export type XSearchDeepChunk = {
	index: number;
	start: number;
	end: number;
	text: string;
	response_id?: string;
	truncated: boolean;
};

export type XSearchDeepSuccess = {
	success: true;
	provider: "xai";
	credential_source: CredentialSource;
	tool: "x_search_deep";
	model: string;
	query: string;
	char_count?: number;
	chunk_size: number;
	max_chunks: number;
	overlap_chars: number;
	chunks_requested: number;
	complete: boolean;
	output_mode: XSearchDeepOutputMode;
	output_path?: string;
	bytes_written?: number;
	full_text?: string;
	answer: string;
	chunks: XSearchDeepChunk[];
	chunks_written?: number;
	warnings: string[];
	citations: unknown[];
	inline_citations: InlineCitation[];
};

export type XSearchDetails = XSearchSuccess | XSearchDeepSuccess | XSearchFailure;

export type ToolResult = {
	content: Array<{ type: "text"; text: string }>;
	details: XSearchDetails;
	isError?: boolean;
};

export type ModelRegistryLike = {
	getApiKeyForProvider(provider: string): Promise<string | undefined>;
	find?(provider: string, modelId: string): { baseUrl?: string } | undefined;
};

export type ExtensionContextLike = {
	modelRegistry: ModelRegistryLike;
};

export type ExtensionApiLike = {
	registerProvider?(
		name: string,
		config: {
			name?: string;
			baseUrl?: string;
			oauth?: {
				name: string;
				login(callbacks: OAuthLoginCallbacks): Promise<OAuthCredentials>;
				usesCallbackServer?: boolean;
				refreshToken(credentials: OAuthCredentials): Promise<OAuthCredentials>;
				getApiKey(credentials: OAuthCredentials): string;
				modifyModels?(
					models: Array<{ provider: string; baseUrl?: string }>,
					credentials: OAuthCredentials,
				): Array<{ provider: string; baseUrl?: string }>;
			};
		},
	): void;
	registerTool(tool: {
		name: string;
		label: string;
		description: string;
		promptSnippet?: string;
		promptGuidelines?: string[];
		parameters: unknown;
		execute(
			toolCallId: string,
			params: XSearchParams | XSearchDeepParams,
			signal: AbortSignal | undefined,
			onUpdate: unknown,
			ctx: ExtensionContextLike,
		): Promise<ToolResult>;
	}): void;
};

export type ResolvedCredential = {
	source: CredentialSource;
	apiKey: string;
};

export type FetchResponseLike = {
	ok: boolean;
	status: number;
	text(): Promise<string>;
};

export type FetchLike = (
	url: string,
	init: {
		method: "POST";
		headers: Record<string, string>;
		body: string;
		signal?: AbortSignal;
	},
) => Promise<FetchResponseLike>;

export type ExecuteOptions = {
	fetchImpl?: FetchLike;
	model?: string;
	baseUrl?: string;
	timeoutMs?: number;
	retries?: number;
	signal?: AbortSignal;
};

export const XSearchParametersSchema = Type.Object({
	query: Type.String({ description: "The X/Twitter search query to run through xAI's built-in x_search tool." }),
	allowed_x_handles: Type.Optional(
		Type.Array(Type.String({ description: "X handle to allow, with or without @." }), {
			description: "Optional allow-list of X handles. Cannot be combined with excluded_x_handles.",
		}),
	),
	excluded_x_handles: Type.Optional(
		Type.Array(Type.String({ description: "X handle to exclude, with or without @." }), {
			description: "Optional block-list of X handles. Cannot be combined with allowed_x_handles.",
		}),
	),
	from_date: Type.Optional(Type.String({ description: "Optional start date filter accepted by xAI x_search." })),
	to_date: Type.Optional(Type.String({ description: "Optional end date filter accepted by xAI x_search." })),
	enable_image_understanding: Type.Optional(
		Type.Boolean({ description: "Ask xAI x_search to use image understanding when available." }),
	),
	enable_video_understanding: Type.Optional(
		Type.Boolean({ description: "Ask xAI x_search to use video understanding when available." }),
	),
	return_full_text: Type.Optional(
		Type.Boolean({ description: "Return the complete original post text verbatim instead of a summary." }),
	),
});

export const XSearchDeepParametersSchema = Type.Object({
	query: Type.String({ description: "The X/Twitter status URL or search query whose complete post text should be reconstructed." }),
	allowed_x_handles: Type.Optional(
		Type.Array(Type.String({ description: "X handle to allow, with or without @." }), {
			description: "Optional allow-list of X handles. Cannot be combined with excluded_x_handles.",
		}),
	),
	excluded_x_handles: Type.Optional(
		Type.Array(Type.String({ description: "X handle to exclude, with or without @." }), {
			description: "Optional block-list of X handles. Cannot be combined with allowed_x_handles.",
		}),
	),
	from_date: Type.Optional(Type.String({ description: "Optional start date filter accepted by xAI x_search." })),
	to_date: Type.Optional(Type.String({ description: "Optional end date filter accepted by xAI x_search." })),
	enable_image_understanding: Type.Optional(
		Type.Boolean({ description: "Ask xAI x_search to use image understanding when available." }),
	),
	enable_video_understanding: Type.Optional(
		Type.Boolean({ description: "Ask xAI x_search to use video understanding when available." }),
	),
	chunk_size: Type.Optional(
		Type.Number({
			description: `Characters to request per chunk. Defaults to ${DEFAULT_DEEP_CHUNK_SIZE}.`,
			minimum: MIN_DEEP_CHUNK_SIZE,
			maximum: MAX_DEEP_CHUNK_SIZE,
		}),
	),
	max_chunks: Type.Optional(
		Type.Number({
			description: `Maximum chunks to request. Defaults to ${DEFAULT_DEEP_MAX_CHUNKS}.`,
			minimum: 1,
			maximum: MAX_DEEP_MAX_CHUNKS,
		}),
	),
	overlap_chars: Type.Optional(
		Type.Number({
			description: `Characters of overlap between adjacent chunks for manual verification. Defaults to ${DEFAULT_DEEP_OVERLAP_CHARS}.`,
			minimum: 0,
			maximum: MAX_DEEP_OVERLAP_CHARS,
		}),
	),
	output_mode: Type.Optional(
		Type.Union([Type.Literal("inline"), Type.Literal("file")], {
			description: `Where to place reconstructed text. Defaults to ${DEFAULT_DEEP_OUTPUT_MODE} to avoid large tool-response truncation.`,
		}),
	),
	output_path: Type.Optional(
		Type.String({ description: "Optional Markdown file path for output_mode=file. Relative paths resolve from the current working directory." }),
	),
});

function getEnv(name: string): string | undefined {
	return typeof process !== "undefined" ? process.env[name] : undefined;
}

function nonEmptyEnv(name: string): string | undefined {
	const value = getEnv(name)?.trim();
	return value ? value : undefined;
}

function cwd(): string {
	return typeof process !== "undefined" ? process.cwd() : ".";
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
	if (!value) return fallback;
	const parsed = Number.parseInt(value, 10);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseBoundedInt(value: number | undefined, fallback: number, min: number, max: number): number {
	if (value === undefined) return fallback;
	const parsed = Math.trunc(value);
	if (!Number.isFinite(parsed)) return fallback;
	return Math.min(max, Math.max(min, parsed));
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined;
}

function asString(value: unknown): string | undefined {
	return typeof value === "string" ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function asArray(value: unknown): unknown[] {
	return Array.isArray(value) ? value : [];
}

function normalizeBaseUrl(baseUrl: string): string {
	return baseUrl.trim().replace(/\/+$/, "") || DEFAULT_XAI_BASE_URL;
}

function sanitizeFilePart(value: string): string {
	return value.trim().replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "x-post";
}

function extractStatusId(query: string): string | undefined {
	return query.match(/status\/(\d+)/)?.[1];
}

export function resolveDeepOutputPath(params: XSearchDeepParams): string {
	const outputPath = params.output_path?.trim();
	if (outputPath) return isAbsolute(outputPath) ? outputPath : join(cwd(), outputPath);

	const outputDir = nonEmptyEnv("PI_X_SEARCH_DEEP_OUTPUT_DIR") ?? join(cwd(), "x-search-deep-results");
	const id = extractStatusId(params.query) ?? sanitizeFilePart(params.query);
	return join(outputDir, `${id}.md`);
}

async function writeMarkdownHeader(path: string, params: XSearchDeepParams, meta: { charCount: number | undefined; chunkSize: number; maxChunks: number; overlapChars: number; chunksRequested: number }): Promise<void> {
	await mkdir(dirname(path), { recursive: true });
	const lines = [
		"# X Search Deep Result",
		"",
		`Query: ${params.query.trim()}`,
		`Generated at: ${new Date().toISOString()}`,
		`Reported char_count: ${meta.charCount ?? "unknown"}`,
		`Chunk size: ${meta.chunkSize}`,
		`Max chunks: ${meta.maxChunks}`,
		`Overlap chars: ${meta.overlapChars}`,
		`Chunks requested: ${meta.chunksRequested}`,
		"",
		"## Reconstructed Text",
		"",
	];
	await writeFile(path, lines.join("\n"), "utf8");
}

async function appendMarkdownChunk(path: string, chunk: XSearchDeepChunk): Promise<number> {
	const content = [
		`\n<!-- chunk ${chunk.index + 1}: chars ${chunk.start}-${chunk.end}; truncated=${chunk.truncated} -->\n`,
		chunk.text,
		"\n",
	].join("");
	await appendFile(path, content, "utf8");
	return Buffer.byteLength(content, "utf8");
}

async function appendMarkdownWarnings(path: string, warnings: readonly string[], complete: boolean): Promise<number> {
	const lines = ["", "## Retrieval Status", "", `Complete: ${complete}`, "", "## Warnings", ""];
	if (warnings.length === 0) {
		lines.push("- None");
	} else {
		for (const warning of warnings) lines.push(`- ${warning}`);
	}
	lines.push("");
	const content = lines.join("\n");
	await appendFile(path, content, "utf8");
	return Buffer.byteLength(content, "utf8");
}

function jsonToolResult(details: XSearchDetails): ToolResult {
	return {
		content: [{ type: "text", text: JSON.stringify(details, null, 2) }],
		details,
		...(details.success ? {} : { isError: true }),
	};
}

export function normalizeHandles(handles: readonly string[] | undefined, fieldName: string): string[] {
	const cleaned: string[] = [];
	for (const handle of handles ?? []) {
		const normalized = handle.trim().replace(/^@+/, "");
		if (normalized && !cleaned.includes(normalized)) {
			cleaned.push(normalized);
		}
	}
	if (cleaned.length > MAX_HANDLES) {
		throw new Error(`${fieldName} supports at most ${MAX_HANDLES} handles`);
	}
	return cleaned;
}

export function buildXSearchToolDefinition(params: XSearchParams): XSearchToolDefinition {
	const allowedHandles = normalizeHandles(params.allowed_x_handles, "allowed_x_handles");
	const excludedHandles = normalizeHandles(params.excluded_x_handles, "excluded_x_handles");
	if (allowedHandles.length > 0 && excludedHandles.length > 0) {
		throw new Error("allowed_x_handles and excluded_x_handles cannot be used together");
	}

	const tool: XSearchToolDefinition = { type: "x_search" };
	if (allowedHandles.length > 0) tool.allowed_x_handles = allowedHandles;
	if (excludedHandles.length > 0) tool.excluded_x_handles = excludedHandles;

	const fromDate = params.from_date?.trim();
	if (fromDate) tool.from_date = fromDate;
	const toDate = params.to_date?.trim();
	if (toDate) tool.to_date = toDate;

	if (params.enable_image_understanding === true) tool.enable_image_understanding = true;
	if (params.enable_video_understanding === true) tool.enable_video_understanding = true;
	if (params.return_full_text === true) tool.return_full_text = true;
	return tool;
}

export function buildXSearchPayload(params: XSearchParams, model: string): XSearchRequestPayload {
	let query = params.query.trim();
	if (!query) {
		throw new Error("query is required");
	}
	if (params.return_full_text === true) {
		query = "Return the complete original post text verbatim. Do not summarize, truncate, or rewrite. Output only the full raw text of the matching X post(s).\n\n" + query;
	}
	return {
		model,
		input: [{ role: "user", content: query }],
		tools: [buildXSearchToolDefinition(params)],
		store: false,
	};
}

export function containsTruncationMarker(text: string): boolean {
	return /<truncated:\d+ bytes original>/i.test(text);
}

export function parseDeepCharCount(text: string): number | undefined {
	const jsonMatch = text.match(/\{[\s\S]*\}/);
	if (jsonMatch) {
		try {
			const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
			const charCount = parsed.char_count;
			if (typeof charCount === "number" && Number.isFinite(charCount) && charCount > 0) {
				return Math.trunc(charCount);
			}
			if (typeof charCount === "string") {
				const numeric = Number.parseInt(charCount.replace(/[^\d]/g, ""), 10);
				return Number.isFinite(numeric) && numeric > 0 ? numeric : undefined;
			}
		} catch {
			// Fall through to regex parsing for model outputs with non-strict JSON.
		}
	}

	const labeledMatch = text.match(/char[_\s-]*count["'\s:=]+([\d,]+)/i);
	if (!labeledMatch?.[1]) return undefined;
	const numeric = Number.parseInt(labeledMatch[1].replace(/,/g, ""), 10);
	return Number.isFinite(numeric) && numeric > 0 ? numeric : undefined;
}

export function resolveDeepOptions(params: XSearchDeepParams): { chunkSize: number; maxChunks: number; overlapChars: number } {
	const chunkSize = parseBoundedInt(params.chunk_size, DEFAULT_DEEP_CHUNK_SIZE, MIN_DEEP_CHUNK_SIZE, MAX_DEEP_CHUNK_SIZE);
	const maxChunks = parseBoundedInt(params.max_chunks, DEFAULT_DEEP_MAX_CHUNKS, 1, MAX_DEEP_MAX_CHUNKS);
	const overlapChars = parseBoundedInt(params.overlap_chars, DEFAULT_DEEP_OVERLAP_CHARS, 0, Math.min(MAX_DEEP_OVERLAP_CHARS, chunkSize - 1));
	return { chunkSize, maxChunks, overlapChars };
}

export function buildXSearchDeepCountQuery(query: string): string {
	return [
		"Find the exact X/Twitter post matching the query below.",
		"Return ONLY compact JSON, with no markdown and no post body.",
		"Schema: {\"char_count\": number}",
		"char_count must be the number of Unicode characters in the original post text, excluding quoted/reposted surrounding UI text.",
		"",
		query.trim(),
	].join("\n");
}

export function buildXSearchDeepChunkQuery(query: string, start: number, end: number): string {
	return [
		"Find the exact X/Twitter post matching the query below.",
		`Return ONLY Unicode characters ${start} through ${end}, inclusive, from the original post text.`,
		"Do not summarize, rewrite, add ellipses, add markdown, add labels, or include any surrounding UI text.",
		"If this range starts after the end of the post, return an empty string.",
		"",
		query.trim(),
	].join("\n");
}

export async function resolveXaiCredential(ctx: ExtensionContextLike): Promise<ResolvedCredential | undefined> {
	const oauthKey = (await ctx.modelRegistry.getApiKeyForProvider("xai-oauth"))?.trim();
	if (oauthKey) {
		return { source: "xai-oauth", apiKey: oauthKey };
	}

	const apiKey = (await ctx.modelRegistry.getApiKeyForProvider("xai"))?.trim();
	if (apiKey) {
		return { source: "xai", apiKey };
	}

	return undefined;
}

export function resolveModel(): string {
	return nonEmptyEnv("PI_X_SEARCH_MODEL") ?? DEFAULT_X_SEARCH_MODEL;
}

export function resolveBaseUrl(ctx: ExtensionContextLike, model: string, override?: string): string {
	const envOverride = nonEmptyEnv("PI_X_SEARCH_BASE_URL") ?? nonEmptyEnv("XAI_BASE_URL");
	if (override) return normalizeBaseUrl(override);
	if (envOverride) return normalizeBaseUrl(envOverride);

	const oauthModel = ctx.modelRegistry.find?.("xai-oauth", model);
	if (oauthModel?.baseUrl) return normalizeBaseUrl(oauthModel.baseUrl);
	const apiKeyModel = ctx.modelRegistry.find?.("xai", model);
	if (apiKeyModel?.baseUrl) return normalizeBaseUrl(apiKeyModel.baseUrl);

	return DEFAULT_XAI_BASE_URL;
}

export function extractResponseText(payload: unknown): string {
	const root = asRecord(payload);
	const outputText = asString(root?.output_text)?.trim();
	if (outputText) return outputText;

	const parts: string[] = [];
	for (const itemValue of asArray(root?.output)) {
		const item = asRecord(itemValue);
		if (item?.type !== "message") continue;
		for (const contentValue of asArray(item.content)) {
			const content = asRecord(contentValue);
			if (!content) continue;
			const type = content?.type;
			if (type !== "output_text" && type !== "text") continue;
			const text = asString(content.text)?.trim();
			if (text) parts.push(text);
		}
	}
	return parts.join("\n\n").trim();
}

export function extractInlineCitations(payload: unknown): InlineCitation[] {
	const root = asRecord(payload);
	const citations: InlineCitation[] = [];
	for (const itemValue of asArray(root?.output)) {
		const item = asRecord(itemValue);
		if (item?.type !== "message") continue;
		for (const contentValue of asArray(item.content)) {
			const content = asRecord(contentValue);
			for (const annotationValue of asArray(content?.annotations)) {
				const annotation = asRecord(annotationValue);
				if (!annotation) continue;
				const url = asString(annotation.url);
				const title = asString(annotation.title);
				if (!url && !title) continue;
				const citation: InlineCitation = {};
				if (title) citation.title = title;
				if (url) citation.url = url;
				const startIndex = asNumber(annotation.start_index);
				if (startIndex !== undefined) citation.start_index = startIndex;
				const endIndex = asNumber(annotation.end_index);
				if (endIndex !== undefined) citation.end_index = endIndex;
				citations.push(citation);
			}
		}
	}
	return citations;
}

export function buildSuccessDetails(
	data: unknown,
	params: XSearchParams,
	credentialSource: CredentialSource,
	model: string,
): XSearchSuccess {
	const root = asRecord(data);
	const responseId = asString(root?.id);
	const details: XSearchSuccess = {
		success: true,
		provider: "xai",
		credential_source: credentialSource,
		tool: "x_search",
		model,
		query: params.query.trim(),
		answer: extractResponseText(data),
		citations: asArray(root?.citations),
		inline_citations: extractInlineCitations(data),
	};
	if (responseId) details.response_id = responseId;
	return details;
}

function createMergedAbortSignal(signal: AbortSignal | undefined, timeoutMs: number): { signal: AbortSignal; cleanup(): void } {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(new Error(`x_search timed out after ${timeoutMs}ms`)), timeoutMs);

	if (signal?.aborted) {
		controller.abort(signal.reason);
	}

	const onAbort = () => controller.abort(signal?.reason);
	if (signal) {
		signal.addEventListener("abort", onAbort, { once: true });
	}

	return {
		signal: controller.signal,
		cleanup() {
			clearTimeout(timer);
			if (signal) signal.removeEventListener("abort", onAbort);
		},
	};
}

async function postResponses(
	fetchImpl: FetchLike,
	url: string,
	apiKey: string,
	payload: XSearchRequestPayload,
	signal: AbortSignal | undefined,
	timeoutMs: number,
): Promise<FetchResponseLike> {
	const merged = createMergedAbortSignal(signal, timeoutMs);
	try {
		return await fetchImpl(url, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${apiKey}`,
				"Content-Type": "application/json",
				"User-Agent": "pi-x-search/0.1",
			},
			body: JSON.stringify(payload),
			signal: merged.signal,
		});
	} finally {
		merged.cleanup();
	}
}

export async function callXaiResponses(
	fetchImpl: FetchLike,
	baseUrl: string,
	apiKey: string,
	payload: XSearchRequestPayload,
	options: { signal: AbortSignal | undefined; timeoutMs: number; retries: number },
): Promise<{ status: number; data: unknown }> {
	const endpoint = `${normalizeBaseUrl(baseUrl)}/responses`;
	let lastError: unknown;

	for (let attempt = 0; attempt <= options.retries; attempt += 1) {
		try {
			const response = await postResponses(fetchImpl, endpoint, apiKey, payload, options.signal, options.timeoutMs);
			const rawText = await response.text();
			let data: unknown;
			try {
				data = rawText ? JSON.parse(rawText) : {};
			} catch {
				data = { raw: rawText };
			}

			if (response.ok) {
				return { status: response.status, data };
			}

			if (response.status >= 500 && attempt < options.retries) {
				lastError = { status: response.status, data };
				continue;
			}

			throw { status: response.status, data };
		} catch (error) {
			lastError = error;
			const status = asNumber(asRecord(error)?.status);
			if ((status !== undefined && status < 500) || options.signal?.aborted) {
				throw error;
			}
			if (attempt >= options.retries) {
				throw error;
			}
		}
	}

	throw lastError;
}

function errorMessageFromData(data: unknown): string {
	const root = asRecord(data);
	const errorRecord = asRecord(root?.error);
	return (
		asString(errorRecord?.message) ??
		asString(root?.message) ??
		asString(root?.error) ??
		asString(root?.raw) ??
		JSON.stringify(data)
	);
}

function failureFromUnknown(
	error: unknown,
	params: XSearchParams,
	model: string,
	credentialSource?: CredentialSource,
	tool: XSearchToolName = "x_search",
): XSearchFailure {
	const errorRecord = asRecord(error);
	const status = asNumber(errorRecord?.status);
	const data = errorRecord?.data;
	const details: XSearchFailure = {
		success: false,
		provider: "xai",
		tool,
		model,
		query: params.query,
		error: data !== undefined ? errorMessageFromData(data) : error instanceof Error ? error.message : String(error),
		error_type: status ? "api_error" : error instanceof Error && error.name === "AbortError" ? "timeout" : "runtime_error",
	};
	if (credentialSource) details.credential_source = credentialSource;
	if (status !== undefined) details.status = status;
	return details;
}

export async function executeXSearch(
	params: XSearchParams,
	ctx: ExtensionContextLike,
	options: ExecuteOptions = {},
): Promise<ToolResult> {
	const model = options.model ?? resolveModel();
	let credentialSource: CredentialSource | undefined;
	try {
		const query = params.query.trim();
		if (!query) {
			return jsonToolResult({
				success: false,
				provider: "xai",
				tool: "x_search",
				model,
				error: "query is required",
				error_type: "validation_error",
			});
		}

		const credential = await resolveXaiCredential(ctx);
		if (!credential) {
			return jsonToolResult({
				success: false,
				provider: "xai",
				tool: "x_search",
				model,
				query,
				error: "No xAI credentials found. Run /login and choose xAI Grok OAuth, or configure XAI_API_KEY for provider xai.",
				error_type: "auth_required",
			});
		}
		credentialSource = credential.source;

		const payload = buildXSearchPayload({ ...params, query }, model);
		const fetchImpl = options.fetchImpl ?? (globalThis.fetch as FetchLike | undefined);
		if (!fetchImpl) {
			return jsonToolResult({
				success: false,
				provider: "xai",
				credential_source: credential.source,
				tool: "x_search",
				model,
				query,
				error: "global fetch is not available in this runtime",
				error_type: "runtime_error",
			});
		}

		const timeoutMs = options.timeoutMs ?? parsePositiveInt(nonEmptyEnv("PI_X_SEARCH_TIMEOUT_MS"), DEFAULT_TIMEOUT_MS);
		const retries = options.retries ?? parsePositiveInt(nonEmptyEnv("PI_X_SEARCH_RETRIES"), DEFAULT_RETRIES);
		const baseUrl = resolveBaseUrl(ctx, model, options.baseUrl);
		const response = await callXaiResponses(fetchImpl, baseUrl, credential.apiKey, payload, {
			signal: options.signal,
			timeoutMs,
			retries,
		});

		return jsonToolResult(buildSuccessDetails(response.data, { ...params, query }, credential.source, model));
	} catch (error) {
		return jsonToolResult(failureFromUnknown(error, params, model, credentialSource));
	}
}

export async function executeXSearchDeep(
	params: XSearchDeepParams,
	ctx: ExtensionContextLike,
	options: ExecuteOptions = {},
): Promise<ToolResult> {
	const model = options.model ?? resolveModel();
	let credentialSource: CredentialSource | undefined;
	try {
		const query = params.query.trim();
		if (!query) {
			return jsonToolResult({
				success: false,
				provider: "xai",
				tool: "x_search_deep",
				model,
				error: "query is required",
				error_type: "validation_error",
			});
		}

		const credential = await resolveXaiCredential(ctx);
		if (!credential) {
			return jsonToolResult({
				success: false,
				provider: "xai",
				tool: "x_search_deep",
				model,
				query,
				error: "No xAI credentials found. Run /login and choose xAI Grok OAuth, or configure XAI_API_KEY for provider xai.",
				error_type: "auth_required",
			});
		}
		credentialSource = credential.source;

		const fetchImpl = options.fetchImpl ?? (globalThis.fetch as FetchLike | undefined);
		if (!fetchImpl) {
			return jsonToolResult({
				success: false,
				provider: "xai",
				credential_source: credential.source,
				tool: "x_search_deep",
				model,
				query,
				error: "global fetch is not available in this runtime",
				error_type: "runtime_error",
			});
		}

		const timeoutMs = options.timeoutMs ?? parsePositiveInt(nonEmptyEnv("PI_X_SEARCH_TIMEOUT_MS"), DEFAULT_TIMEOUT_MS);
		const retries = options.retries ?? parsePositiveInt(nonEmptyEnv("PI_X_SEARCH_RETRIES"), DEFAULT_RETRIES);
		const baseUrl = resolveBaseUrl(ctx, model, options.baseUrl);
		const { chunkSize, maxChunks, overlapChars } = resolveDeepOptions(params);
		const outputMode: XSearchDeepOutputMode = params.output_mode ?? DEFAULT_DEEP_OUTPUT_MODE;
		const outputPath = outputMode === "file" ? resolveDeepOutputPath(params) : undefined;
		const baseParams: XSearchParams = { ...params, query, return_full_text: true };

		const callPrompt = async (prompt: string): Promise<XSearchSuccess> => {
			const payload = buildXSearchPayload({ ...baseParams, query: prompt, return_full_text: true }, model);
			const response = await callXaiResponses(fetchImpl, baseUrl, credential.apiKey, payload, {
				signal: options.signal,
				timeoutMs,
				retries,
			});
			return buildSuccessDetails(response.data, { ...baseParams, query: prompt }, credential.source, model);
		};

		const warnings: string[] = [];
		const metadata = await callPrompt(buildXSearchDeepCountQuery(query));
		const charCount = parseDeepCharCount(metadata.answer);
		if (charCount === undefined) {
			warnings.push("Could not parse char_count from the metadata response; max_chunks will cap retrieval.");
		}
		if (containsTruncationMarker(metadata.answer)) {
			warnings.push("The metadata response contained a truncation marker; char_count may be unreliable.");
		}

		const requiredChunks = charCount === undefined ? maxChunks : Math.ceil(charCount / Math.max(1, chunkSize - overlapChars));
		const chunksRequested = Math.min(maxChunks, Math.max(1, requiredChunks));
		if (charCount !== undefined && requiredChunks > maxChunks) {
			warnings.push(`Post requires ${requiredChunks} chunks at chunk_size=${chunkSize}, but max_chunks=${maxChunks} capped retrieval.`);
		}
		if (outputPath) {
			await writeMarkdownHeader(outputPath, params, { charCount, chunkSize, maxChunks, overlapChars, chunksRequested });
		}

		const chunks: XSearchDeepChunk[] = [];
		let bytesWritten = 0;
		for (let index = 0; index < chunksRequested; index += 1) {
			const start = index * (chunkSize - overlapChars) + 1;
			const end = start + chunkSize - 1;
			const chunk = await callPrompt(buildXSearchDeepChunkQuery(query, start, end));
			const truncated = containsTruncationMarker(chunk.answer);
			if (truncated) warnings.push(`Chunk ${index + 1} contained a truncation marker.`);
			const chunkRecord: XSearchDeepChunk = {
				index,
				start,
				end,
				text: outputMode === "file" ? "" : chunk.answer,
				...(chunk.response_id ? { response_id: chunk.response_id } : {}),
				truncated,
			};
			chunks.push({
				...chunkRecord,
			});
			if (outputPath) bytesWritten += await appendMarkdownChunk(outputPath, { ...chunkRecord, text: chunk.answer });
			if (charCount === undefined && !chunk.answer) break;
		}

		const fullText = chunks.map((chunk, index) => (index > 0 && overlapChars > 0 ? chunk.text.slice(overlapChars) : chunk.text)).join("");
		if (charCount !== undefined && fullText.length < Math.floor(charCount * 0.85)) {
			if (outputMode === "inline") warnings.push(`Merged text length (${fullText.length}) is much shorter than reported char_count (${charCount}).`);
		}
		const complete = warnings.length === 0 && (charCount === undefined || chunksRequested >= requiredChunks);
		if (outputPath) bytesWritten += await appendMarkdownWarnings(outputPath, warnings, complete);
		const answer = outputPath
			? `x_search_deep wrote ${chunks.length} chunks to ${outputPath}. complete=${complete}. warnings=${warnings.length}.`
			: fullText;

		const details: XSearchDeepSuccess = {
			success: true,
			provider: "xai",
			credential_source: credential.source,
			tool: "x_search_deep",
			model,
			query,
			...(charCount !== undefined ? { char_count: charCount } : {}),
			chunk_size: chunkSize,
			max_chunks: maxChunks,
			overlap_chars: overlapChars,
			chunks_requested: chunksRequested,
			complete,
			output_mode: outputMode,
			...(outputPath ? { output_path: outputPath, bytes_written: bytesWritten, chunks_written: chunks.length } : { full_text: fullText }),
			answer,
			chunks,
			warnings,
			citations: metadata.citations,
			inline_citations: metadata.inline_citations,
		};

		return jsonToolResult(details);
	} catch (error) {
		return jsonToolResult(failureFromUnknown(error, params, model, credentialSource, "x_search_deep"));
	}
}

export default function xSearchExtension(pi: ExtensionApiLike): void {
	pi.registerProvider?.("xai-oauth", {
		name: xaiOAuthProvider.name,
		baseUrl: DEFAULT_XAI_BASE_URL,
		oauth: xaiOAuthProvider,
	});

	pi.registerTool({
		name: "x_search",
		label: "X Search",
		description:
			"Search X/Twitter through xAI's built-in x_search Responses tool. Uses Senpi xAI Grok OAuth subscription credentials first, then XAI_API_KEY.",
		promptSnippet: "Search X/Twitter through xAI using x_search when current X posts or account-specific X information are needed.",
		promptGuidelines: [
			"Use x_search for current information from X/Twitter instead of guessing.",
			"Use allowed_x_handles when the user asks about specific X accounts.",
			"Do not combine allowed_x_handles and excluded_x_handles in the same call.",
			"Set return_full_text: true when you need the complete original post text instead of a summary.",
		],
		parameters: XSearchParametersSchema,
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			return signal ? executeXSearch(params as XSearchParams, ctx, { signal }) : executeXSearch(params as XSearchParams, ctx);
		},
	});

	pi.registerTool({
		name: "x_search_deep",
		label: "X Search Deep",
		description:
			"Retrieve long X/Twitter post text through xAI x_search using a metadata pass and chunked range requests, then merge the chunks into one response.",
		promptSnippet:
			"Use x_search_deep when a long X/Twitter post must be reconstructed beyond normal x_search response truncation.",
		promptGuidelines: [
			"Use x_search_deep for long posts where x_search returns a <truncated:...> marker.",
			"Prefer a direct status URL in query so the chunked requests target one exact post.",
			"Increase max_chunks when the reported char_count exceeds chunk_size * max_chunks.",
			"Check complete and warnings before treating full_text as authoritative.",
		],
		parameters: XSearchDeepParametersSchema,
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			return signal ? executeXSearchDeep(params as XSearchDeepParams, ctx, { signal }) : executeXSearchDeep(params as XSearchDeepParams, ctx);
		},
	});
}
