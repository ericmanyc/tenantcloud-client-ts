import type { TcTokenSet, TcTokenStore } from "../auth.js";
import { deserializeTokenSet, serializeTokenSet } from "./fileTokenStore.js";

export interface SecureTokenStoreOptions {
  /** Service name used as the credential identifier in the OS credential store. */
  serviceName?: string;
  /** Account key for distinguishing multiple credential entries. */
  accountKey?: string;
}

/**
 * Stores tokens in the OS-native credential store via @napi-rs/keyring:
 * Credential Manager on Windows, Keychain on macOS, Secret Service on Linux.
 */
export class SecureTokenStore implements TcTokenStore {
  private readonly serviceName: string;
  private readonly accountKey: string;

  constructor(options: SecureTokenStoreOptions = {}) {
    this.serviceName = options.serviceName ?? "tenantcloud-client";
    this.accountKey = options.accountKey ?? "default";
  }

  static isSupported(): boolean {
    return process.platform === "win32" || process.platform === "darwin" || process.platform === "linux";
  }

  private async entry(): Promise<import("@napi-rs/keyring").Entry> {
    const { Entry } = await import("@napi-rs/keyring");
    return new Entry(this.serviceName, this.accountKey);
  }

  async load(): Promise<TcTokenSet | null> {
    try {
      const entry = await this.entry();
      const json = entry.getPassword();
      if (!json) {
        return null;
      }
      return deserializeTokenSet(JSON.parse(json) as Record<string, unknown>);
    } catch {
      return null;
    }
  }

  async save(tokens: TcTokenSet): Promise<void> {
    const entry = await this.entry();
    entry.setPassword(serializeTokenSet(tokens));
  }

  async delete(): Promise<void> {
    try {
      const entry = await this.entry();
      entry.deletePassword();
    } catch {
      // Deleting a non-existent credential is not an error
    }
  }
}
