import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { TcTokenSet, TcTokenStore } from "../auth.js";

/**
 * Reads and writes a TcTokenSet to a JSON file with atomic writes
 * (temp + rename). The file contains sensitive refresh tokens; protect it
 * with appropriate file permissions.
 */
export class FileTokenStore implements TcTokenStore {
  constructor(private readonly filePath: string) {
    if (!filePath) {
      throw new Error("filePath is required");
    }
  }

  async load(): Promise<TcTokenSet | null> {
    try {
      const json = await readFile(this.filePath, "utf8");
      const raw = JSON.parse(json) as Record<string, unknown>;
      return deserializeTokenSet(raw);
    } catch {
      return null;
    }
  }

  async save(tokens: TcTokenSet): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const tempPath = this.filePath + ".tmp";
    try {
      await writeFile(tempPath, serializeTokenSet(tokens), { mode: 0o600 });
      await rename(tempPath, this.filePath);
    } catch (error) {
      await rm(tempPath, { force: true }).catch(() => {});
      throw error;
    }
  }

  async delete(): Promise<void> {
    await rm(this.filePath, { force: true });
  }
}

/** Stored with snake_case keys, compatible with the C# implementation. */
export function serializeTokenSet(tokens: TcTokenSet): string {
  return JSON.stringify({
    access_token: tokens.accessToken,
    refresh_token: tokens.refreshToken,
    fingerprint: tokens.fingerprint,
  });
}

export function deserializeTokenSet(raw: Record<string, unknown>): TcTokenSet | null {
  const accessToken = raw["access_token"];
  const refreshToken = raw["refresh_token"];
  const fingerprint = raw["fingerprint"];
  if (
    typeof accessToken !== "string" ||
    typeof refreshToken !== "string" ||
    typeof fingerprint !== "string"
  ) {
    return null;
  }
  return { accessToken, refreshToken, fingerprint };
}
