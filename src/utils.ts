// AGENTS: fmt->calc.ts | err->try-catch | no-disk-IO
import * as vscode from 'vscode';
import { KimiOAuthCredentials } from './types';

const SECRET_API_KEY = 'kimiStatusPro.apiKey';
const SECRET_OAUTH = 'kimiStatusPro.oauthCredentials';

let outputChannel: vscode.OutputChannel | undefined;

export function getOutputChannel(): vscode.OutputChannel {
  if (!outputChannel) {
    outputChannel = vscode.window.createOutputChannel('KimiStatusPro');
  }
  return outputChannel;
}

export function log(message: string): void {
  const ts = new Date().toLocaleString('zh-CN', { hour12: false });
  getOutputChannel().appendLine(`[${ts}] ${message}`);
}

export async function readApiKey(secrets: vscode.SecretStorage): Promise<string | undefined> {
  return secrets.get(SECRET_API_KEY) || undefined;
}

export async function writeApiKey(secrets: vscode.SecretStorage, key: string): Promise<void> {
  await secrets.store(SECRET_API_KEY, key);
}

export async function deleteApiKey(secrets: vscode.SecretStorage): Promise<void> {
  await secrets.delete(SECRET_API_KEY);
}

export async function readOAuth(secrets: vscode.SecretStorage): Promise<KimiOAuthCredentials | undefined> {
  const raw = await secrets.get(SECRET_OAUTH);
  if (!raw) return undefined;
  try { return JSON.parse(raw); } catch { return undefined; }
}

export async function writeOAuth(secrets: vscode.SecretStorage, creds: KimiOAuthCredentials): Promise<void> {
  await secrets.store(SECRET_OAUTH, JSON.stringify(creds));
}

export async function deleteOAuth(secrets: vscode.SecretStorage): Promise<void> {
  await secrets.delete(SECRET_OAUTH);
}

export function readKimiCliCredentials(): KimiOAuthCredentials | undefined {
  try {
    const fs = require('fs');
    const path = require('path');
    const os = require('os');
    const credPath = path.join(os.homedir(), '.kimi', 'credentials', 'kimi-code.json');
    if (!fs.existsSync(credPath)) return undefined;
    const raw = fs.readFileSync(credPath, 'utf-8');
    const parsed = JSON.parse(raw);
    if (!parsed.access_token) return undefined;
    return {
      accessToken: parsed.access_token,
      refreshToken: parsed.refresh_token ?? '',
      tokenType: parsed.token_type ?? 'Bearer',
      expiresAt: Math.floor(parsed.expires_at ?? 0),
      scope: parsed.scope ?? 'kimi-code',
      deviceId: parsed.device_id ?? '',
    };
  } catch { return undefined; }
}
