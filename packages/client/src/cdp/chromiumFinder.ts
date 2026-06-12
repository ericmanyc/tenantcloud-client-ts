import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface ChromiumBrowser {
  name: string;
  executablePath: string;
}

/**
 * Finds installed Chromium-based browsers, preferring the user's default
 * browser when detectable. Returns an ordered list (best candidate first).
 */
export async function findChromiumBrowsers(): Promise<ChromiumBrowser[]> {
  switch (process.platform) {
    case "darwin":
      return findOnMacOS();
    case "win32":
      return findOnWindows();
    case "linux":
      return findOnLinux();
    default:
      return [];
  }
}

const MACOS_CANDIDATES: Array<ChromiumBrowser & { bundleId: string }> = [
  {
    name: "Chrome",
    bundleId: "com.google.chrome",
    executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  },
  {
    name: "Edge",
    bundleId: "com.microsoft.edgemac",
    executablePath: "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  },
  {
    name: "Brave",
    bundleId: "com.brave.browser",
    executablePath: "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
  },
  {
    name: "Vivaldi",
    bundleId: "com.vivaldi.vivaldi",
    executablePath: "/Applications/Vivaldi.app/Contents/MacOS/Vivaldi",
  },
  {
    name: "Chromium",
    bundleId: "org.chromium.chromium",
    executablePath: "/Applications/Chromium.app/Contents/MacOS/Chromium",
  },
];

async function findOnMacOS(): Promise<ChromiumBrowser[]> {
  const defaultBundleId = await detectMacOSDefaultBrowser();
  const results: ChromiumBrowser[] = [];

  if (defaultBundleId) {
    const preferred = MACOS_CANDIDATES.find(
      (c) => c.bundleId.toLowerCase() === defaultBundleId.toLowerCase(),
    );
    if (preferred && existsSync(preferred.executablePath)) {
      results.push({ name: preferred.name, executablePath: preferred.executablePath });
    }
  }

  for (const candidate of MACOS_CANDIDATES) {
    if (results.some((b) => b.name === candidate.name)) {
      continue;
    }
    if (existsSync(candidate.executablePath)) {
      results.push({ name: candidate.name, executablePath: candidate.executablePath });
    }
  }

  return results;
}

async function detectMacOSDefaultBrowser(): Promise<string | null> {
  try {
    const plistPath = join(
      homedir(),
      "Library/Preferences/com.apple.LaunchServices/com.apple.launchservices.secure.plist",
    );
    const { stdout } = await execFileAsync("plutil", [
      "-extract",
      "LSHandlers",
      "json",
      "-o",
      "-",
      plistPath,
    ]);

    const handlers = JSON.parse(stdout) as Array<Record<string, string>>;
    const httpsHandler = handlers.find((h) => h["LSHandlerURLScheme"] === "https");
    return httpsHandler?.["LSHandlerRoleAll"] ?? null;
  } catch {
    return null;
  }
}

async function findOnWindows(): Promise<ChromiumBrowser[]> {
  const programFiles = process.env["ProgramFiles"] ?? "C:\\Program Files";
  const programFilesX86 = process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)";
  const localAppData = process.env["LOCALAPPDATA"] ?? "";

  const candidates: Array<{ name: string; progId: string; paths: string[] }> = [
    {
      name: "Edge",
      progId: "MSEdgeHTM",
      paths: [
        join(programFilesX86, "Microsoft\\Edge\\Application\\msedge.exe"),
        join(programFiles, "Microsoft\\Edge\\Application\\msedge.exe"),
      ],
    },
    {
      name: "Chrome",
      progId: "ChromeHTML",
      paths: [
        join(programFiles, "Google\\Chrome\\Application\\chrome.exe"),
        join(localAppData, "Google\\Chrome\\Application\\chrome.exe"),
      ],
    },
    {
      name: "Brave",
      progId: "BraveHTML",
      paths: [
        join(programFiles, "BraveSoftware\\Brave-Browser\\Application\\brave.exe"),
        join(localAppData, "BraveSoftware\\Brave-Browser\\Application\\brave.exe"),
      ],
    },
    {
      name: "Vivaldi",
      progId: "VivaldiHTM",
      paths: [join(localAppData, "Vivaldi\\Application\\vivaldi.exe")],
    },
    {
      name: "Chromium",
      progId: "ChromiumHTM",
      paths: [join(localAppData, "Chromium\\Application\\chrome.exe")],
    },
  ];

  const defaultProgId = await detectWindowsDefaultBrowser();
  const results: ChromiumBrowser[] = [];

  if (defaultProgId) {
    for (const { name, progId, paths } of candidates) {
      if (defaultProgId.toLowerCase().includes(progId.toLowerCase())) {
        const exe = paths.find(existsSync);
        if (exe) {
          results.push({ name, executablePath: exe });
        }
        break;
      }
    }
  }

  for (const { name, paths } of candidates) {
    if (results.some((b) => b.name === name)) {
      continue;
    }
    const exe = paths.find(existsSync);
    if (exe) {
      results.push({ name, executablePath: exe });
    }
  }

  return results;
}

async function detectWindowsDefaultBrowser(): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("reg", [
      "query",
      "HKCU\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\https\\UserChoice",
      "/v",
      "ProgId",
    ]);

    for (const line of stdout.split("\n")) {
      if (line.toLowerCase().includes("progid")) {
        const parts = line.trim().split(/[\s\t]+/);
        if (parts.length >= 3) {
          return parts[parts.length - 1] ?? null;
        }
      }
    }
    return null;
  } catch {
    return null;
  }
}

async function findOnLinux(): Promise<ChromiumBrowser[]> {
  const candidates: Array<{ name: string; command: string }> = [
    { name: "Chrome", command: "google-chrome" },
    { name: "Chromium", command: "chromium-browser" },
    { name: "Edge", command: "microsoft-edge-stable" },
    { name: "Brave", command: "brave-browser" },
  ];

  const results: ChromiumBrowser[] = [];
  for (const { name, command } of candidates) {
    try {
      const { stdout } = await execFileAsync("which", [command]);
      const path = stdout.trim();
      if (path && existsSync(path)) {
        results.push({ name, executablePath: path });
      }
    } catch {
      // Not installed
    }
  }

  return results;
}
