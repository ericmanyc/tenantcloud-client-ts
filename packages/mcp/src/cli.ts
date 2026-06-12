#!/usr/bin/env node
import { SecureTokenStore } from "tenantcloud-client";
import { CdpTokenProvider } from "tenantcloud-client/cdp";
import { login, logout } from "./authCommands.js";
import { install } from "./installCommand.js";
import { runServer } from "./server.js";
import { VERSION } from "./version.js";

function printHelp(): void {
  console.log(`tc-mcp v${VERSION} - TenantCloud MCP server`);
  console.log();
  console.log("Usage: tc-mcp <command>");
  console.log();
  console.log("Commands:");
  console.log("  mcp                       Start the MCP server (stdio transport)");
  console.log("  login                     Authenticate and store tokens");
  console.log("  login --remote <url> --email <e> --code <c>");
  console.log("                            Pair your TenantCloud account with a hosted server");
  console.log("  logout                    Remove stored tokens");
  console.log("  install claude-desktop    Register in Claude Desktop config");
  console.log("  install claude-code       Register in Claude Code via CLI");
  console.log("  serve                     Run the hosted multi-user server (Railway etc.)");
  console.log("  invite <email> --server <url>");
  console.log("                            Admin: invite a teammate to a hosted server");
}

async function main(): Promise<number> {
  const [command, ...rest] = process.argv.slice(2);

  switch (command?.toLowerCase()) {
    case "mcp": {
      // No unprompted login windows from the server: interactive login only
      // happens through the explicit tc_login tool (or the `login` command).
      const provider = new CdpTokenProvider({
        tokenStore: new SecureTokenStore(),
        allowInteractiveLogin: false,
      });
      await runServer(provider);
      // Keep the process alive; the stdio transport closes it on disconnect
      return new Promise<number>(() => {});
    }
    case "login": {
      if (rest.includes("--remote")) {
        const { pairWithRemote, parseFlags } = await import("./remote/cliCommands.js");
        const { flags } = parseFlags(rest);
        return pairWithRemote(flags["remote"] ?? "", flags["email"] ?? "", flags["code"] ?? "");
      }
      return login();
    }
    case "logout":
      return logout();
    case "install":
      return install(rest[0]);
    case "serve": {
      const { serve } = await import("./remote/serveCommand.js");
      return serve();
    }
    case "invite": {
      const { inviteTeammate } = await import("./remote/cliCommands.js");
      return inviteTeammate(rest);
    }
    case undefined:
      printHelp();
      return 0;
    default:
      printHelp();
      return 1;
  }
}

main().then(
  (code) => {
    if (code !== 0) {
      process.exitCode = code;
    }
  },
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  },
);
