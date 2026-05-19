import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import xSearchExtension, {
	DEFAULT_X_SEARCH_MODEL,
	buildXSearchDeepChunkQuery,
	buildXSearchDeepCountQuery,
	buildXSearchPayload,
	buildXSearchToolDefinition,
	containsTruncationMarker,
	executeXSearchDeep,
	executeXSearch,
	extractInlineCitations,
	extractResponseText,
	normalizeHandles,
	parseDeepCharCount,
	parseXaiAuthorizationInput,
	resolveXaiCredential,
	xaiOAuthProvider,
	type ExtensionApiLike,
	type ExtensionContextLike,
	type FetchLike,
} from "../src/index.ts";

function createContext(keys: Partial<Record<"xai-oauth" | "xai", string>>, calls: string[] = []): ExtensionContextLike {
	return {
		modelRegistry: {
			async getApiKeyForProvider(provider: string) {
				calls.push(provider);
				return keys[provider as "xai-oauth" | "xai"];
			},
			find(_provider: string, _modelId: string) {
				return { baseUrl: "https://api.x.ai/v1/" };
			},
		},
	};
}

test("resolveXaiCredential prefers xai-oauth over xai", async () => {
	const calls: string[] = [];
	const credential = await resolveXaiCredential(createContext({ "xai-oauth": "oauth-token", xai: "api-key" }, calls));

	assert.deepEqual(credential, { source: "xai-oauth", apiKey: "oauth-token" });
	assert.deepEqual(calls, ["xai-oauth"]);
});

test("resolveXaiCredential falls back to xai API key", async () => {
	const calls: string[] = [];
	const credential = await resolveXaiCredential(createContext({ xai: "api-key" }, calls));

	assert.deepEqual(credential, { source: "xai", apiKey: "api-key" });
	assert.deepEqual(calls, ["xai-oauth", "xai"]);
});

test("xSearchExtension registers xai-oauth login provider", () => {
	const providers: Array<Parameters<NonNullable<ExtensionApiLike["registerProvider"]>>> = [];
	const tools: string[] = [];
	const pi: ExtensionApiLike = {
		registerProvider(...args) {
			providers.push(args);
		},
		registerTool(tool) {
			tools.push(tool.name);
		},
	};

	xSearchExtension(pi);

	assert.equal(providers.length, 1);
	assert.equal(providers[0]?.[0], "xai-oauth");
	assert.equal(providers[0]?.[1].oauth?.name, "xAI Grok OAuth");
	assert.equal(providers[0]?.[1].oauth?.usesCallbackServer, true);
	assert.equal(providers[0]?.[1].oauth?.getApiKey({ access: "oauth-token", refresh: "refresh", expires: 0 }), "oauth-token");
	assert.deepEqual(tools, ["x_search", "x_search_deep"]);
});

test("parseXaiAuthorizationInput accepts redirect URLs, query strings, and raw codes", () => {
	assert.deepEqual(parseXaiAuthorizationInput("http://127.0.0.1:56121/callback?code=abc&state=state-1"), {
		code: "abc",
		state: "state-1",
		error: undefined,
		errorDescription: undefined,
	});
	assert.deepEqual(parseXaiAuthorizationInput("code=abc&state=state-1"), {
		code: "abc",
		state: "state-1",
		error: undefined,
		errorDescription: undefined,
	});
	assert.deepEqual(parseXaiAuthorizationInput("abc#state-1"), { code: "abc", state: "state-1" });
	assert.deepEqual(parseXaiAuthorizationInput("abc"), { code: "abc" });
});

test("xaiOAuthProvider exposes access token as API key", () => {
	assert.equal(xaiOAuthProvider.id, "xai-oauth");
	assert.equal(xaiOAuthProvider.getApiKey({ access: "access-token", refresh: "refresh-token", expires: Date.now() }), "access-token");
});

test("normalizeHandles strips @, deduplicates, and enforces conflicts in tool payload", () => {
	assert.deepEqual(normalizeHandles(["@xai", "xai", " @nousresearch "], "allowed_x_handles"), ["xai", "nousresearch"]);
	assert.throws(
		() => buildXSearchToolDefinition({ query: "grok", allowed_x_handles: ["xai"], excluded_x_handles: ["foo"] }),
		/allowed_x_handles and excluded_x_handles/,
	);
});

test("buildXSearchPayload uses grok-4.3, store:false, and x_search tool", () => {
	const payload = buildXSearchPayload(
		{
			query: "latest grok posts",
			allowed_x_handles: ["@xai"],
			enable_image_understanding: true,
		},
		DEFAULT_X_SEARCH_MODEL,
	);

	assert.equal(payload.model, "grok-4.3");
	assert.equal(payload.store, false);
	assert.equal(payload.input[0]?.content, "latest grok posts");
	assert.deepEqual(payload.tools, [
		{
			type: "x_search",
			allowed_x_handles: ["xai"],
			enable_image_understanding: true,
		},
	]);
});

test("x_search_deep helpers build metadata and chunk prompts", () => {
	const countQuery = buildXSearchDeepCountQuery("https://x.com/xai/status/1");
	const chunkQuery = buildXSearchDeepChunkQuery("https://x.com/xai/status/1", 101, 200);

	assert.match(countQuery, /Return ONLY compact JSON/);
	assert.match(countQuery, /char_count/);
	assert.match(chunkQuery, /characters 101 through 200/);
	assert.equal(parseDeepCharCount('{"char_count": "1,234"}'), 1234);
	assert.equal(containsTruncationMarker("before <truncated:5668 bytes original> after"), true);
});

test("extractors read output_text and inline citations", () => {
	const payload = {
		id: "resp_1",
		output: [
			{
				type: "message",
				content: [
					{
						type: "output_text",
						text: "Grok update found.",
						annotations: [{ title: "xAI", url: "https://x.com/xai/status/1", start_index: 0, end_index: 3 }],
					},
				],
			},
		],
	};

	assert.equal(extractResponseText(payload), "Grok update found.");
	assert.deepEqual(extractInlineCitations(payload), [
		{ title: "xAI", url: "https://x.com/xai/status/1", start_index: 0, end_index: 3 },
	]);
});

test("executeXSearch sends xAI Responses request without leaking credentials", async () => {
	let capturedUrl = "";
	let capturedHeaders: Record<string, string> = {};
	let capturedBody: unknown;
	const fetchImpl: FetchLike = async (url, init) => {
		capturedUrl = url;
		capturedHeaders = init.headers;
		capturedBody = JSON.parse(init.body) as unknown;
		return {
			ok: true,
			status: 200,
			async text() {
				return JSON.stringify({ id: "resp_1", output_text: "Latest @xai post mentions Grok.", citations: ["https://x.com/xai"] });
			},
		};
	};

	const result = await executeXSearch(
		{ query: "Search X for Grok", allowed_x_handles: ["@xai"] },
		createContext({ "xai-oauth": "oauth-secret", xai: "api-secret" }),
		{ fetchImpl, timeoutMs: 1_000, retries: 0 },
	);

	assert.equal(result.isError, undefined);
	assert.equal(result.details.success, true);
	assert.equal(result.details.credential_source, "xai-oauth");
	assert.equal(result.details.answer, "Latest @xai post mentions Grok.");
	assert.equal(capturedUrl, "https://api.x.ai/v1/responses");
	assert.equal(capturedHeaders.Authorization, "Bearer oauth-secret");
	assert.deepEqual(capturedBody, {
		model: "grok-4.3",
		input: [{ role: "user", content: "Search X for Grok" }],
		tools: [{ type: "x_search", allowed_x_handles: ["xai"] }],
		store: false,
	});
	assert.doesNotMatch(result.content[0]?.text ?? "", /oauth-secret|api-secret/);
});

test("executeXSearchDeep gets char count, requests chunks, and merges full_text", async () => {
	const chunk1 = "A".repeat(200);
	const chunk2 = "B".repeat(200);
	const chunk3 = "C";
	const requestedPrompts: string[] = [];
	const fetchImpl: FetchLike = async (_url, init) => {
		const body = JSON.parse(init.body) as { input: Array<{ content: string }> };
		const prompt = body.input[0]?.content ?? "";
		requestedPrompts.push(prompt);

		let outputText = '{"char_count": 401}';
		if (prompt.includes("characters 1 through 200")) outputText = chunk1;
		if (prompt.includes("characters 201 through 400")) outputText = chunk2;
		if (prompt.includes("characters 401 through 600")) outputText = chunk3;

		return {
			ok: true,
			status: 200,
			async text() {
				return JSON.stringify({ id: `resp_${requestedPrompts.length}`, output_text: outputText });
			},
		};
	};

	const result = await executeXSearchDeep(
		{ query: "https://x.com/xai/status/1", chunk_size: 200, max_chunks: 5, output_mode: "inline" },
		createContext({ "xai-oauth": "oauth-secret" }),
		{ fetchImpl, timeoutMs: 1_000, retries: 0 },
	);

	assert.equal(result.isError, undefined);
	assert.equal(result.details.success, true);
	assert.equal(result.details.tool, "x_search_deep");
	if (result.details.success && result.details.tool === "x_search_deep") {
		assert.equal(result.details.char_count, 401);
		assert.equal(result.details.chunks_requested, 3);
		assert.equal(result.details.full_text, `${chunk1}${chunk2}${chunk3}`);
		assert.equal(result.details.complete, true);
		assert.deepEqual(result.details.warnings, []);
	}
	assert.equal(requestedPrompts.length, 4);
	assert.match(requestedPrompts[0] ?? "", /char_count/);
	assert.match(requestedPrompts[3] ?? "", /characters 401 through 600/);
});

test("executeXSearchDeep file mode writes markdown and returns compact details", async () => {
	const tempDir = await mkdtemp(join(tmpdir(), "pi-x-search-"));
	try {
		const outputPath = join(tempDir, "post.md");
		const fetchImpl: FetchLike = async (_url, init) => {
			const body = JSON.parse(init.body) as { input: Array<{ content: string }> };
			const prompt = body.input[0]?.content ?? "";
			let outputText = '{"char_count": 250}';
			if (prompt.includes("characters 1 through 200")) outputText = "A".repeat(200);
			if (prompt.includes("characters 201 through 400")) outputText = "B".repeat(50);

			return {
				ok: true,
				status: 200,
				async text() {
					return JSON.stringify({ id: "resp_file", output_text: outputText });
				},
			};
		};

		const result = await executeXSearchDeep(
			{ query: "https://x.com/xai/status/2", chunk_size: 200, max_chunks: 3, output_mode: "file", output_path: outputPath },
			createContext({ "xai-oauth": "oauth-secret" }),
			{ fetchImpl, timeoutMs: 1_000, retries: 0 },
		);

		assert.equal(result.isError, undefined);
		assert.equal(result.details.success, true);
		assert.equal(result.details.tool, "x_search_deep");
		if (result.details.success && result.details.tool === "x_search_deep") {
			assert.equal(result.details.output_mode, "file");
			assert.equal(result.details.output_path, outputPath);
			assert.equal(result.details.full_text, undefined);
			assert.equal(result.details.chunks_written, 2);
			assert.equal(result.details.chunks[0]?.text, "");
			assert.match(result.details.answer, /wrote 2 chunks/);
		}

		const markdown = await readFile(outputPath, "utf8");
		assert.match(markdown, /# X Search Deep Result/);
		assert.match(markdown, /Reported char_count: 250/);
		assert.match(markdown, /<!-- chunk 1: chars 1-200; truncated=false -->/);
		assert.match(markdown, /A{200}/);
		assert.match(markdown, /B{50}/);
	} finally {
		await rm(tempDir, { recursive: true, force: true });
	}
});

test("executeXSearch reports auth_required when no credential exists", async () => {
	const result = await executeXSearch({ query: "grok" }, createContext({}), { timeoutMs: 1_000, retries: 0 });

	assert.equal(result.isError, true);
	assert.equal(result.details.success, false);
	assert.equal(result.details.error_type, "auth_required");
});

test("executeXSearch surfaces xAI API errors", async () => {
	const fetchImpl: FetchLike = async () => ({
		ok: false,
		status: 403,
		async text() {
			return JSON.stringify({ error: { message: "x_search is not enabled" } });
		},
	});

	const result = await executeXSearch({ query: "grok" }, createContext({ "xai-oauth": "oauth-secret" }), {
		fetchImpl,
		timeoutMs: 1_000,
		retries: 0,
	});

	assert.equal(result.isError, true);
	assert.equal(result.details.success, false);
	assert.equal(result.details.error_type, "api_error");
	assert.equal(result.details.status, 403);
	assert.equal(result.details.error, "x_search is not enabled");
});
