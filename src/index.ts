import { Type } from "typebox";

export const DEFAULT_X_SEARCH_MODEL = "grok-4.3";
export const DEFAULT_XAI_BASE_URL = "https://api.x.ai/v1";
export const DEFAULT_TIMEOUT_MS = 180_000;
export const DEFAULT_RETRIES = 2;
export const MAX_HANDLES = 10;

export type CredentialSource = "xai-oauth" | "xai";

export type XSearchParams = {
	query: string;
	allowed_x_handles?: string[];
	excluded_x_handles?: string[];
	from_date?: string;
	to_date?: string;
	enable_image_understanding?: boolean;
	enable_video_understanding?: boolean;
};

export type XSearchToolDefinition = {
	type: "x_search";
	allowed_x_handles?: string[];
	excluded_x_handles?: string[];
	from_date?: string;
	to_date?: string;
	enable_image_understanding?: true;
	enable_video_understanding?: true;
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
	tool: "x_search";
	model?: string;
	query?: string;
	error: string;
	error_type: string;
	status?: number;
};

export type XSearchDetails = XSearchSuccess | XSearchFailure;

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
	registerTool(tool: {
		name: string;
		label: string;
		description: string;
		promptSnippet?: string;
		promptGuidelines?: string[];
		parameters: typeof XSearchParametersSchema;
		execute(
			toolCallId: string,
			params: XSearchParams,
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
});

function getEnv(name: string): string | undefined {
	return typeof process !== "undefined" ? process.env[name] : undefined;
}

function nonEmptyEnv(name: string): string | undefined {
	const value = getEnv(name)?.trim();
	return value ? value : undefined;
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
	if (!value) return fallback;
	const parsed = Number.parseInt(value, 10);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
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
	return tool;
}

export function buildXSearchPayload(params: XSearchParams, model: string): XSearchRequestPayload {
	const query = params.query.trim();
	if (!query) {
		throw new Error("query is required");
	}
	return {
		model,
		input: [{ role: "user", content: query }],
		tools: [buildXSearchToolDefinition(params)],
		store: false,
	};
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
): XSearchFailure {
	const errorRecord = asRecord(error);
	const status = asNumber(errorRecord?.status);
	const data = errorRecord?.data;
	const details: XSearchFailure = {
		success: false,
		provider: "xai",
		tool: "x_search",
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

export default function xSearchExtension(pi: ExtensionApiLike): void {
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
		],
		parameters: XSearchParametersSchema,
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			return signal ? executeXSearch(params, ctx, { signal }) : executeXSearch(params, ctx);
		},
	});
}
