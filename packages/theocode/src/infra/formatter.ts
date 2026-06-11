/**
 * `formatter` — output formatting utilities for tool results.
 *
 * Wraps code, diffs, file lists, errors, and truncated output references.
 */

/**
 * Wrap code in a fenced code block with language tag.
 */
export function formatCode(language: string, code: string): string {
  return `\`\`\`${language}\n${code}\n\`\`\``;
}

/**
 * Format a unified diff with +/- prefixes preserved.
 */
export function formatDiff(diff: string): string {
  return `\`\`\`diff\n${diff}\n\`\`\``;
}

/**
 * Format a list of file paths as a bulleted markdown list.
 */
export function formatFileList(files: string[]): string {
  if (files.length === 0) return "(no files)";
  return files.map((f) => `- ${f}`).join("\n");
}

/**
 * Format an error message as a markdown block.
 */
export function formatError(message: string, code?: string): string {
  const prefix = code ? `[${code}] ` : "";
  return `> **Error:** ${prefix}${message}`;
}

/**
 * Format a truncated output reference.
 */
export function formatTruncated(overflowPath: string): string {
  return `...full output at: ${overflowPath}`;
}
