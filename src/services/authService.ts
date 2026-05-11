// 🔀 Provider boundary: token resolution is Kimi-specific.

import * as vscode from 'vscode';
import { KimiOAuthCredentials } from '../types';
import { readApiKey, readOAuth, writeOAuth, deleteOAuth, readKimiCliCredentials } from '../utils';

const REFRESH_THRESHOLD_SECONDS = 300;

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
      const refreshed = await this.refreshAccessToken(creds);
      await writeOAuth(this.secrets, refreshed);
      this.cachedToken = refreshed.accessToken;
      this.cachedAt = Date.now();
      return refreshed.accessToken;
    } catch {
      await deleteOAuth(this.secrets);
      this.invalidate();
      return undefined;
    }
  }

  invalidate(): void {
    this.cachedToken = null;
    this.cachedAt = 0;
  }

  private async refreshAccessToken(_creds: KimiOAuthCredentials): Promise<KimiOAuthCredentials> {
    // OAuth refresh implementation (same as legacy code)
    // POST https://auth.kimi.com/api/oauth/token
    // body: grant_type=refresh_token&refresh_token=...&client_id=...
    // Returns new credentials
    throw new Error('Not implemented in Phase 1');
  }
}
