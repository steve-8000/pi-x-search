const ISSUER = "https://auth.x.ai";
const DISCOVERY_URL = `${ISSUER}/.well-known/openid-configuration`;
const CLIENT_ID = "b1a00492-073a-47ea-816f-4c329264a828";
const SCOPE = "openid profile email offline_access grok-cli:access api:access";
const REDIRECT_HOST = "127.0.0.1";
const REDIRECT_PORT = 56121;
const REDIRECT_PATH = "/callback";
const REDIRECT_URI = `http://${REDIRECT_HOST}:${REDIRECT_PORT}${REDIRECT_PATH}`;
const DEFAULT_BASE_URL = "https://api.x.ai/v1";
const REFRESH_SKEW_MS = 120_000;

type Discovery = {
	authorization_endpoint: string;
	token_endpoint: string;
};

type TokenPayload = {
	access_token?: unknown;
	refresh_token?: unknown;
	id_token?: unknown;
	expires_in?: unknown;
	token_type?: unknown;
};

type CallbackResult = {
	code?: string | undefined;
	state?: string | undefined;
	error?: string | undefined;
	errorDescription?: string | undefined;
};

export type OAuthCredentials = {
	refresh: string;
	access: string;
	expires: number;
	[key: string]: unknown;
};

export type OAuthAuthInfo = {
	url: string;
	instructions?: string;
};

export type OAuthPrompt = {
	message: string;
	placeholder?: string;
	allowEmpty?: boolean;
};

export type OAuthSelectOption = {
	id: string;
	label: string;
};

export type OAuthSelectPrompt = {
	message: string;
	options: OAuthSelectOption[];
};

export interface OAuthLoginCallbacks {
	onAuth: (info: OAuthAuthInfo) => void;
	onPrompt: (prompt: OAuthPrompt) => Promise<string>;
	onProgress?: (message: string) => void;
	onManualCodeInput?: () => Promise<string>;
	onSelect?: (prompt: OAuthSelectPrompt) => Promise<string | undefined>;
	signal?: AbortSignal;
}

export interface OAuthProviderInterface {
	readonly id: string;
	readonly name: string;
	login(callbacks: OAuthLoginCallbacks): Promise<OAuthCredentials>;
	usesCallbackServer?: boolean;
	refreshToken(credentials: OAuthCredentials): Promise<OAuthCredentials>;
	getApiKey(credentials: OAuthCredentials): string;
	modifyModels?(models: Array<{ provider: string; baseUrl?: string }>, credentials: OAuthCredentials): Array<{ provider: string; baseUrl?: string }>;
}

export function parseXaiAuthorizationInput(input: string): CallbackResult {
	const value = input.trim();
	if (!value) return {};

	try {
		const url = new URL(value);
		return {
			code: url.searchParams.get("code") ?? undefined,
			state: url.searchParams.get("state") ?? undefined,
			error: url.searchParams.get("error") ?? undefined,
			errorDescription: url.searchParams.get("error_description") ?? undefined,
		};
	} catch {
		// not a URL
	}

	if (value.includes("code=") || value.includes("error=")) {
		const params = new URLSearchParams(value);
		return {
			code: params.get("code") ?? undefined,
			state: params.get("state") ?? undefined,
			error: params.get("error") ?? undefined,
			errorDescription: params.get("error_description") ?? undefined,
		};
	}

	if (value.includes("#")) {
		const [code, state] = value.split("#", 2);
		return { code, state };
	}

	return { code: value };
}

function escapeHtml(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;");
}

function oauthPage(title: string, heading: string, message: string, details?: string): string {
	const renderedDetails = details ? `<pre>${escapeHtml(details)}</pre>` : "";
	return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>html{color-scheme:dark}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#09090b;color:#fafafa;font-family:system-ui,sans-serif;text-align:center;padding:24px}main{max-width:560px}p,pre{color:#a1a1aa;line-height:1.7}pre{white-space:pre-wrap;word-break:break-word}</style></head><body><main><h1>${escapeHtml(heading)}</h1><p>${escapeHtml(message)}</p>${renderedDetails}</main></body></html>`;
}

function oauthSuccessHtml(message: string): string {
	return oauthPage("Authentication successful", "Authentication successful", message);
}

function oauthErrorHtml(message: string, details?: string): string {
	return oauthPage("Authentication failed", "Authentication failed", message, details);
}

function base64urlEncode(bytes: Uint8Array): string {
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

async function generatePKCE(): Promise<{ verifier: string; challenge: string }> {
	const verifierBytes = new Uint8Array(32);
	crypto.getRandomValues(verifierBytes);
	const verifier = base64urlEncode(verifierBytes);
	const hashBuffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
	return { verifier, challenge: base64urlEncode(new Uint8Array(hashBuffer)) };
}

function randomString(): string {
	return crypto.randomUUID?.().replace(/-/g, "") ?? Math.random().toString(36).slice(2);
}

function validateXaiEndpoint(url: string, field: string): void {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		throw new Error(`xAI OAuth discovery ${field} is not a valid URL`);
	}
	if (parsed.protocol !== "https:") {
		throw new Error(`xAI OAuth discovery ${field} must use https`);
	}
	const host = parsed.hostname.toLowerCase();
	if (host !== "x.ai" && !host.endsWith(".x.ai")) {
		throw new Error(`xAI OAuth discovery ${field} must be hosted on x.ai or a subdomain`);
	}
}

function decodeJwtExpiryMs(token: string): number | undefined {
	try {
		const payload = token.split(".")[1];
		if (!payload) return undefined;
		const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
		const decoded = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="));
		const parsed = JSON.parse(decoded) as { exp?: unknown };
		return typeof parsed.exp === "number" ? parsed.exp * 1000 : undefined;
	} catch {
		return undefined;
	}
}

function expiresFromToken(accessToken: string, expiresIn: unknown): number {
	const jwtExpiry = decodeJwtExpiryMs(accessToken);
	if (jwtExpiry) return jwtExpiry - REFRESH_SKEW_MS;
	if (typeof expiresIn === "number" && Number.isFinite(expiresIn)) {
		return Date.now() + expiresIn * 1000 - REFRESH_SKEW_MS;
	}
	return Date.now() + 55 * 60 * 1000;
}

async function discover(): Promise<Discovery> {
	const response = await fetch(DISCOVERY_URL, { headers: { Accept: "application/json" } });
	if (!response.ok) {
		throw new Error(`xAI OAuth discovery failed with status ${response.status}`);
	}
	const payload = (await response.json()) as Partial<Discovery>;
	const authorizationEndpoint = String(payload.authorization_endpoint || "").trim();
	const tokenEndpoint = String(payload.token_endpoint || "").trim();
	if (!authorizationEndpoint || !tokenEndpoint) {
		throw new Error("xAI OAuth discovery response is missing endpoints");
	}
	validateXaiEndpoint(authorizationEndpoint, "authorization_endpoint");
	validateXaiEndpoint(tokenEndpoint, "token_endpoint");
	return { authorization_endpoint: authorizationEndpoint, token_endpoint: tokenEndpoint };
}

function buildAuthorizeUrl(discovery: Discovery, codeChallenge: string, state: string, nonce: string): string {
	const params = new URLSearchParams({
		response_type: "code",
		client_id: CLIENT_ID,
		redirect_uri: REDIRECT_URI,
		scope: SCOPE,
		code_challenge: codeChallenge,
		code_challenge_method: "S256",
		state,
		nonce,
		plan: "generic",
		referrer: "senpi",
	});
	return `${discovery.authorization_endpoint}?${params.toString()}`;
}

async function waitForCallback(signal?: AbortSignal): Promise<CallbackResult> {
	const http = await import("node:http");

	return new Promise<CallbackResult>((resolve, reject) => {
		let settled = false;
		const server = http.createServer((req, res) => {
			try {
				const url = new URL(req.url || "/", REDIRECT_URI);
				if (url.pathname !== REDIRECT_PATH) {
					res.writeHead(404);
					res.end("Not found");
					return;
				}

				const result: CallbackResult = {
					code: url.searchParams.get("code") ?? undefined,
					state: url.searchParams.get("state") ?? undefined,
					error: url.searchParams.get("error") ?? undefined,
					errorDescription: url.searchParams.get("error_description") ?? undefined,
				};
				res.writeHead(result.error ? 400 : 200, { "Content-Type": "text/html" });
				res.end(
					result.error
						? oauthErrorHtml("xAI authorization failed", result.errorDescription ?? result.error)
						: oauthSuccessHtml("You can close this browser tab and return to senpi."),
				);
				if (!settled) {
					settled = true;
					resolve(result);
				}
			} catch (error) {
				if (!settled) {
					settled = true;
					reject(error);
				}
			} finally {
				server.close();
			}
		});

		server.on("error", (error) => {
			if (!settled) {
				settled = true;
				reject(error);
			}
		});

		const abort = () => {
			server.close();
			if (!settled) {
				settled = true;
				reject(new Error("xAI OAuth login was aborted"));
			}
		};
		signal?.addEventListener("abort", abort, { once: true });

		server.listen(REDIRECT_PORT, REDIRECT_HOST);
	});
}

async function exchangeToken(tokenEndpoint: string, body: URLSearchParams): Promise<TokenPayload> {
	validateXaiEndpoint(tokenEndpoint, "token_endpoint");
	const response = await fetch(tokenEndpoint, {
		method: "POST",
		headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
		body,
	});
	if (!response.ok) {
		const text = await response.text().catch(() => "");
		throw new Error(`xAI token request failed with status ${response.status}${text ? `: ${text}` : ""}`);
	}
	return (await response.json()) as TokenPayload;
}

function credentialsFromTokenPayload(payload: TokenPayload, discovery: Discovery, redirectUri: string): OAuthCredentials {
	const access = String(payload.access_token || "").trim();
	const refresh = String(payload.refresh_token || "").trim();
	if (!access) throw new Error("xAI token response is missing access_token");
	if (!refresh) throw new Error("xAI token response is missing refresh_token");

	return {
		access,
		refresh,
		expires: expiresFromToken(access, payload.expires_in),
		idToken: String(payload.id_token || "").trim() || undefined,
		tokenType: String(payload.token_type || "Bearer").trim() || "Bearer",
		tokenEndpoint: discovery.token_endpoint,
		authorizationEndpoint: discovery.authorization_endpoint,
		redirectUri,
		baseUrl: process.env.XAI_BASE_URL?.trim().replace(/\/$/, "") || DEFAULT_BASE_URL,
	};
}

export async function loginXaiOAuth(callbacks: OAuthLoginCallbacks): Promise<OAuthCredentials> {
	callbacks.onProgress?.("Discovering xAI OAuth endpoints...");
	const discovery = await discover();
	const { verifier, challenge } = await generatePKCE();
	const state = randomString();
	const nonce = randomString();
	const authorizeUrl = buildAuthorizeUrl(discovery, challenge, state, nonce);

	callbacks.onAuth({
		url: authorizeUrl,
		instructions: "Authorize xAI in your browser. If xAI says it could not reach your app, paste the displayed code into senpi.",
	});

	const callbackPromise = waitForCallback(callbacks.signal).catch((error) => {
		callbacks.onProgress?.(`Local callback failed: ${error instanceof Error ? error.message : String(error)}`);
		return undefined;
	});
	const manualPromise = callbacks.onManualCodeInput?.().then(parseXaiAuthorizationInput);
	const result = manualPromise ? await Promise.race([callbackPromise, manualPromise]) : await callbackPromise;

	if (result?.error) throw new Error(`xAI authorization failed: ${result.errorDescription ?? result.error}`);
	if (result?.state && result.state !== state) throw new Error("xAI authorization failed: state mismatch");
	if (!result?.code) throw new Error("xAI authorization failed: missing authorization code");

	callbacks.onProgress?.("Exchanging xAI authorization code...");
	const payload = await exchangeToken(
		discovery.token_endpoint,
		new URLSearchParams({
			grant_type: "authorization_code",
			client_id: CLIENT_ID,
			code: result.code,
			code_verifier: verifier,
			redirect_uri: REDIRECT_URI,
		}),
	);
	return credentialsFromTokenPayload(payload, discovery, REDIRECT_URI);
}

export async function refreshXaiOAuthToken(credentials: OAuthCredentials): Promise<OAuthCredentials> {
	const tokenEndpoint = String(credentials.tokenEndpoint || "").trim() || (await discover()).token_endpoint;
	const payload = await exchangeToken(
		tokenEndpoint,
		new URLSearchParams({
			grant_type: "refresh_token",
			client_id: CLIENT_ID,
			refresh_token: credentials.refresh,
		}),
	);
	const authorizationEndpoint = String(credentials.authorizationEndpoint || "") || (await discover()).authorization_endpoint;
	return credentialsFromTokenPayload(
		{
			...payload,
			refresh_token: payload.refresh_token || credentials.refresh,
		},
		{ authorization_endpoint: authorizationEndpoint, token_endpoint: tokenEndpoint },
		String(credentials.redirectUri || REDIRECT_URI),
	);
}

export const xaiOAuthProvider: OAuthProviderInterface = {
	id: "xai-oauth",
	name: "xAI Grok OAuth",
	usesCallbackServer: true,
	login: loginXaiOAuth,
	refreshToken: refreshXaiOAuthToken,
	getApiKey(credentials) {
		return credentials.access;
	},
	modifyModels(models, credentials) {
		const baseUrl = String(credentials.baseUrl || DEFAULT_BASE_URL).replace(/\/$/, "");
		return models.map((model) => (model.provider === "xai-oauth" ? { ...model, baseUrl } : model));
	},
};
