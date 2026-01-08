/**
 * Output formatting utilities
 * Handles color support detection and styled output
 */

// Check if colors should be disabled
function shouldDisableColor(): boolean {
  // NO_COLOR env var (https://no-color.org/)
  if (process.env["NO_COLOR"] !== undefined) {
    return true;
  }
  // TERM=dumb
  if (process.env["TERM"] === "dumb") {
    return true;
  }
  // Not a TTY
  if (!process.stdout.isTTY) {
    return true;
  }
  return false;
}

let forceNoColor = false;

/**
 * Set color mode explicitly (for --no-color flag)
 */
export function setNoColor(value: boolean): void {
  forceNoColor = value;
}

/**
 * Check if colors are enabled
 */
export function colorsEnabled(): boolean {
  return !forceNoColor && !shouldDisableColor();
}

// ANSI color codes
const colors = {
  reset: "\x1b[0m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
} as const;

/**
 * Apply color to text if colors are enabled
 */
function colorize(text: string, color: keyof typeof colors): string {
  if (!colorsEnabled()) {
    return text;
  }
  return `${colors[color]}${text}${colors.reset}`;
}

export const style = {
  error: (text: string) => colorize(text, "red"),
  success: (text: string) => colorize(text, "green"),
  warn: (text: string) => colorize(text, "yellow"),
  info: (text: string) => colorize(text, "blue"),
  cyan: (text: string) => colorize(text, "cyan"),
  dim: (text: string) => colorize(text, "dim"),
  bold: (text: string) => colorize(text, "bold"),
};

/**
 * Print error message to stderr
 */
export function printError(message: string): void {
  console.error(style.error("Error:"), message);
}

/**
 * Print success message
 */
export function printSuccess(message: string): void {
  console.log(style.success("✓"), message);
}
