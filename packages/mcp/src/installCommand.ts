import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * Command + args other tools should use to launch this MCP server.
 * When installed via npm the `tc-mcp` bin is on PATH; otherwise fall back
 * to `node <path-to-cli.js> mcp`.
 */
function serverInvocation(): { command: string; args: string[] } {
  const cliPath = fileURLToPath(new URL("./cli.js", import.meta.url));
  return { command: process.execPath, args: [cliPath, "mcp"] };
}

export async function install(target: string | undefined): Promise<number> {
  if (!target) {
    console.error("Usage: tc-mcp install <target>");
    console.error("  Targets: claude-desktop, claude-code");
    return 1;
  }

  switch (target.toLowerCase()) {
    case "claude-desktop":
      return installClaudeDesktop();
    case "claude-code":
      return installClaudeCode();
    default:
      console.error(`Unknown install target: ${target}`);
      console.error("  Supported targets: claude-desktop, claude-code");
      return 1;
  }
}

function claudeDesktopConfigPath(): string | null {
  switch (process.platform) {
    case "win32": {
      const appData = process.env["APPDATA"];
      return appData ? join(appData, "Claude", "claude_desktop_config.json") : null;
    }
    case "darwin":
      return join(homedir(), "Library", "Application Support", "Claude", "claude_desktop_config.json");
    default:
      return null; // No standard Claude Desktop config path on Linux
  }
}

async function installClaudeDesktop(): Promise<number> {
  const configPath = claudeDesktopConfigPath();
  if (!configPath) {
    console.error("Error: Could not determine Claude Desktop config location for this platform.");
    return 1;
  }

  await mkdir(dirname(configPath), { recursive: true });

  let root: Record<string, unknown> = {};
  if (existsSync(configPath)) {
    try {
      root = JSON.parse(await readFile(configPath, "utf8")) as Record<string, unknown>;
    } catch {
      console.error(`Error: ${configPath} exists but is not valid JSON. Fix or remove it first.`);
      return 1;
    }
  }

  const { command, args } = serverInvocation();
  const servers = (root["mcpServers"] ??= {}) as Record<string, unknown>;
  servers["tc-mcp"] = { command, args };

  const tempPath = configPath + ".tmp";
  await writeFile(tempPath, JSON.stringify(root, null, 2));
  await rename(tempPath, configPath);

  console.log(`Registered tc-mcp in ${configPath}`);
  console.log("Please restart Claude Desktop to pick up the changes.");
  return 0;
}

async function installClaudeCode(): Promise<number> {
  const { command, args } = serverInvocation();

  try {
    const { stdout, stderr } = await execFileAsync("claude", [
      "mcp",
      "add",
      "--transport",
      "stdio",
      "tc-mcp",
      "--",
      command,
      ...args,
    ]);

    if (stdout.trim()) {
      console.log(stdout.trim());
    }
    if (stderr.trim()) {
      console.error(stderr.trim());
    }
    console.log("Successfully registered tc-mcp with Claude Code.");
    return 0;
  } catch (error) {
    console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
    console.error("Make sure the 'claude' CLI is installed and available on your PATH.");
    return 1;
  }
}
