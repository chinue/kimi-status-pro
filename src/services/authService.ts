// 🔀 Provider boundary: token resolution is Kimi-specific.
// AGENTS: err->try-catch | secret-safe

import * as crypto from 'crypto';
// DESIGN: v2-phase2-implementation.md#servicesauthservicets
import * as vscode from 'vscode';
import fetch from 'node-fetch';
import { KimiOAuthCredentials } from '../types';
import { readApiKey, readOAuth, writeOAuth, deleteOAuth, readKimiCliCredentials, log } from '../utils';

const CLIENT_ID = '17e5f671-d194-4dfb-9706-5516cb48c098';
const OAUTH_HOST = 'https://auth.kimi.com';
const DEVICE_CODE_PATH = '/api/oauth/device_authorization';
const TOKEN_PATH = '/api/oauth/token';
const REFRESH_THRESHOLD_SECONDS = 300;
const HTTP_TIMEOUT_MS = 15_000;

interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete?: string;
  expires_in: number;
  interval: number;
}

interface OAuthTokenWire {
  access_token?: string;
  refresh_token?: string;
  token_type?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
  error_description?: string;
}

export interface AuthorizationPending { kind: 'pending'; }
export interface AuthorizationFailed { kind: 'failed'; error: string; }
export interface AuthorizationSuccess { kind: 'success'; creds: KimiOAuthCredentials; }
export type PollOutcome = AuthorizationPending | AuthorizationFailed | AuthorizationSuccess;

function commonHeaders(deviceId: string): Record<string, string> {
  return {
    'Content-Type': 'application/x-www-form-urlencoded',
    Accept: 'application/json',
    'X-Msh-Platform': 'kimi-status-pro-vscode',
    'X-Msh-Version': '0.4.0',
    'X-Msh-Device-Id': deviceId,
  };
}

async function postForm(host: string, path: string, body: URLSearchParams, headers: Record<string, string>): Promise<{ status: number; body: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);
  try {
    const resp = await fetch(`${host}${path}`, {
      method: 'POST',
      headers: { ...headers, 'Content-Length': String(Buffer.byteLength(body.toString())) },
      body: body.toString(),
      signal: controller.signal,
    });
    const text = await resp.text();
    return { status: resp.status, body: text };
  } finally {
    clearTimeout(timeout);
  }
}

export async function requestDeviceCode(deviceId: string): Promise<DeviceCodeResponse> {
  const body = new URLSearchParams({ client_id: CLIENT_ID });
  const { status, body: text } = await postForm(OAUTH_HOST, DEVICE_CODE_PATH, body, commonHeaders(deviceId));
  if (status !== 200) {
    throw new Error(`device_authorization failed: HTTP ${status} ${text.slice(0, 200)}`);
  }
  const parsed = JSON.parse(text) as DeviceCodeResponse;
  if (!parsed.device_code || !parsed.user_code) {
    throw new Error('device_authorization response missing required fields');
  }
  return parsed;
}

export async function exchangeDeviceCode(deviceId: string, deviceCode: string): Promise<PollOutcome> {
  const body = new URLSearchParams({
    client_id: CLIENT_ID,
    device_code: deviceCode,
    grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
  });
  const { body: text } = await postForm(OAUTH_HOST, TOKEN_PATH, body, commonHeaders(deviceId));
  const wire = JSON.parse(text) as OAuthTokenWire;
  if (wire.error === 'authorization_pending' || wire.error === 'slow_down') {
    return { kind: 'pending' };
  }
  if (wire.error) {
    return { kind: 'failed', error: `${wire.error}: ${wire.error_description ?? ''}`.trim() };
  }
  if (!wire.access_token) {
    return { kind: 'failed', error: 'empty access_token in response' };
  }
  return { kind: 'success', creds: wireToCredentials(wire, deviceId) };
}

export async function refreshAccessToken(creds: KimiOAuthCredentials): Promise<KimiOAuthCredentials> {
  const body = new URLSearchParams({
    client_id: CLIENT_ID,
    grant_type: 'refresh_token',
    refresh_token: creds.refreshToken,
  });
  const { status, body: text } = await postForm(OAUTH_HOST, TOKEN_PATH, body, commonHeaders(creds.deviceId));
  if (status === 401 || status === 403) {
    throw new Error(`refresh_token rejected (HTTP ${status})`);
  }
  if (status !== 200) {
    throw new Error(`refresh failed: HTTP ${status} ${text.slice(0, 200)}`);
  }
  const wire = JSON.parse(text) as OAuthTokenWire;
  if (!wire.access_token) {
    throw new Error('empty access_token in refresh response');
  }
  return wireToCredentials(wire, creds.deviceId, creds.refreshToken);
}

function wireToCredentials(wire: OAuthTokenWire, deviceId: string, fallbackRefresh = ''): KimiOAuthCredentials {
  const expiresIn = wire.expires_in ?? 0;
  return {
    accessToken: wire.access_token ?? '',
    refreshToken: wire.refresh_token ?? fallbackRefresh,
    tokenType: wire.token_type ?? 'Bearer',
    expiresAt: expiresIn > 0 ? Math.floor(Date.now() / 1000) + Math.floor(expiresIn) : 0,
    scope: wire.scope ?? 'kimi-code',
    deviceId,
  };
}

function newDeviceId(): string {
  return crypto.randomUUID();
}

export class AuthService {
  private static instance: AuthService;
  private secrets: vscode.SecretStorage | undefined;
  private cachedToken: string | null = null;
  private cachedAt = 0;

  static getInstance(): AuthService {
    if (!AuthService.instance) { AuthService.instance = new AuthService(); }
    return AuthService.instance;
  }

  init(secrets: vscode.SecretStorage): void {
    this.secrets = secrets;
  }

  /** Resolve token with 60s memory cache to avoid frequent SecretStorage reads. */
  async resolveToken(): Promise<string | undefined> {
    if (!this.secrets) return undefined;
    if (this.cachedToken && Date.now() - this.cachedAt < 60_000) {
      return this.cachedToken;
    }

    let creds = await readOAuth(this.secrets);

    // Fallback 1: CLI credentials file
    if (!creds) {
      creds = readKimiCliCredentials();
      if (creds) { await writeOAuth(this.secrets, creds); }
    }

    // Fallback 2: API Key
    if (!creds) {
      const apiKey = await readApiKey(this.secrets);
      if (apiKey) {
        this.cachedToken = apiKey;
        this.cachedAt = Date.now();
        return apiKey;
      }
    }

    if (!creds) return undefined;

    // Check expiration
    const now = Math.floor(Date.now() / 1000);
    if (creds.expiresAt === 0 || creds.expiresAt - now > REFRESH_THRESHOLD_SECONDS) {
      this.cachedToken = creds.accessToken;
      this.cachedAt = Date.now();
      return creds.accessToken;
    }

    // Refresh token
    try {
      const refreshed = await refreshAccessToken(creds);
      await writeOAuth(this.secrets, refreshed);
      this.cachedToken = refreshed.accessToken;
      this.cachedAt = Date.now();
      return refreshed.accessToken;
    } catch (err) {
      log(`Refresh failed: ${(err as Error).message}. Clearing OAuth credentials.`);
      await deleteOAuth(this.secrets);
      this.invalidate();
      return undefined;
    }
  }

  /** Start OAuth device code flow, open browser, poll for token. */
  async startOAuthFlow(): Promise<boolean> {
    if (!this.secrets) return false;

    const deviceId = newDeviceId();
    let deviceCodeResp: DeviceCodeResponse;
    try {
      deviceCodeResp = await requestDeviceCode(deviceId);
    } catch (err) {
      void vscode.window.showErrorMessage(`Kimi sign-in failed: ${(err as Error).message}`);
      return false;
    }

    const uri = deviceCodeResp.verification_uri_complete ?? deviceCodeResp.verification_uri;
    void vscode.env.openExternal(vscode.Uri.parse(uri));
    void vscode.window.showInformationMessage(
      `Kimi sign-in: enter code "${deviceCodeResp.user_code}" in the browser if not automatically redirected.`
    );

    const expiresAt = Date.now() + (deviceCodeResp.expires_in * 1000);
    const intervalMs = (deviceCodeResp.interval ?? 5) * 1000;

    while (Date.now() < expiresAt) {
      await sleep(intervalMs);
      const outcome = await exchangeDeviceCode(deviceId, deviceCodeResp.device_code);
      if (outcome.kind === 'success') {
        await writeOAuth(this.secrets, outcome.creds);
        this.invalidate();
        void vscode.window.showInformationMessage('Kimi sign-in successful.');
        return true;
      }
      if (outcome.kind === 'failed') {
        void vscode.window.showErrorMessage(`Kimi sign-in failed: ${outcome.error}`);
        return false;
      }
      // pending: continue polling
    }

    void vscode.window.showWarningMessage('Kimi sign-in timed out. Please try again.');
    return false;
  }

  invalidate(): void {
    this.cachedToken = null;
    this.cachedAt = 0;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
