import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  unlinkSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { PaprikaConfig } from "./types.js";
import { ExitCode } from "./types.js";
import { printError } from "./output.js";

const CONFIG_DIR = join(homedir(), ".config", "paprika-cli");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

/**
 * Get the path to the config file
 */
export function getConfigPath(): string {
  return CONFIG_FILE;
}

/**
 * Load config from file
 */
export function loadConfig(): PaprikaConfig | null {
  if (!existsSync(CONFIG_FILE)) {
    return null;
  }
  try {
    const data = readFileSync(CONFIG_FILE, "utf-8");
    return JSON.parse(data) as PaprikaConfig;
  } catch {
    return null;
  }
}

/**
 * Load config from environment variables
 */
export function loadConfigFromEnv(): PaprikaConfig | null {
  const email = process.env["PAPRIKA_EMAIL"];
  const password = process.env["PAPRIKA_PASSWORD"];

  if (email && password) {
    return { email, password };
  }
  return null;
}

/**
 * Save config to file
 */
export function saveConfig(config: PaprikaConfig): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), {
    mode: 0o600, // read/write for owner only
  });
}

/**
 * Clear stored config
 */
export function clearConfig(): void {
  if (existsSync(CONFIG_FILE)) {
    unlinkSync(CONFIG_FILE);
  }
}

/**
 * Get config, preferring env vars over file
 * Exits with appropriate code if not configured
 */
export function requireConfig(): PaprikaConfig {
  // Try env vars first (higher precedence)
  const envConfig = loadConfigFromEnv();
  if (envConfig) {
    return envConfig;
  }

  // Fall back to file
  const fileConfig = loadConfig();
  if (fileConfig?.email && (fileConfig.password || fileConfig.token)) {
    return fileConfig;
  }

  printError("Not authenticated. Run: paprika auth");
  printError(
    "Or set PAPRIKA_EMAIL and PAPRIKA_PASSWORD environment variables."
  );
  process.exit(ExitCode.AuthFailure);
}
