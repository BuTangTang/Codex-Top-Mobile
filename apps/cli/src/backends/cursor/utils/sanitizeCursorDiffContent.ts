/**
 * Cursor emits ACP `tool_call`/`tool_call_update` diff content blocks
 * (`{ type: 'diff', path, oldText, newText }`) but corrupts the payload by jamming
 * unified-diff *file header* lines into the content fields, e.g.:
 *
 *   oldText: "-- /dev/null\n"
 *   newText: "++ b//Users/.../hello.py\nprint(\"hello world\")"
 *
 * The generic ACP normalizer + UI EditView already render `{ path, oldText, newText }`
 * diff blocks correctly; the only thing broken is this Cursor-specific header noise.
 * So this sanitizer (a Cursor-only quirk fixer) strips the leading `--`/`---` and
 * `++`/`+++` file-header lines, restoring clean old/new file contents. It is wired in
 * via the generic `TransportHandler.sanitizeToolUpdateContent` seam so no Cursor logic
 * leaks into the provider-agnostic update pipeline.
 */

// A leading unified-diff "old file" header line: `-- /dev/null`, `-- a/path`, `--- a/path`, `-- /abs`.
const OLD_FILE_HEADER = /^-{2,3} (?:\/dev\/null|[ab]\/[^\n]*|\/[^\n]*)(?:\n|$)/;
// A leading unified-diff "new file" header line: `++ b/path`, `+++ b/path`, `++ /dev/null`.
const NEW_FILE_HEADER = /^\+{2,3} (?:\/dev\/null|[ab]\/[^\n]*|\/[^\n]*)(?:\n|$)/;

function stripUnifiedDiffHeaderLine(text: string, headerRe: RegExp): string {
  const match = headerRe.exec(text);
  const stripped = match ? text.slice(match[0].length) : text;
  // A pure "/dev/null" sentinel (file add/delete) means "no content on this side".
  return stripped.trim() === '/dev/null' ? '' : stripped;
}

/**
 * Return a copy of an ACP tool update with Cursor's diff content blocks cleaned.
 * Non-diff content, non-string fields, and non-array content are returned unchanged
 * (same reference) so this is safe to call on every update.
 */
export function sanitizeCursorDiffContent<T extends { content?: unknown }>(update: T): T {
  const content = update.content;
  if (!Array.isArray(content)) return update;

  let changed = false;
  const nextContent = content.map((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return entry;
    const record = entry as Record<string, unknown>;
    if (record.type !== 'diff') return entry;

    const oldText = typeof record.oldText === 'string'
      ? stripUnifiedDiffHeaderLine(record.oldText, OLD_FILE_HEADER)
      : record.oldText;
    const newText = typeof record.newText === 'string'
      ? stripUnifiedDiffHeaderLine(record.newText, NEW_FILE_HEADER)
      : record.newText;

    if (oldText === record.oldText && newText === record.newText) return entry;
    changed = true;
    return { ...record, oldText, newText };
  });

  if (!changed) return update;
  return { ...update, content: nextContent };
}
