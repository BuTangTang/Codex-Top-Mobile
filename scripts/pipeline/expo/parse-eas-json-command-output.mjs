// @ts-check

/**
 * @param {string} text
 * @param {number} startIndex
 * @returns {string | null}
 */
function extractBalancedJsonBlock(text, startIndex) {
  const opener = text[startIndex];
  const closer = opener === '{' ? '}' : opener === '[' ? ']' : '';
  if (!closer) return null;

  let depth = 0;
  let inString = false;
  let escaping = false;
  for (let index = startIndex; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaping) {
        escaping = false;
        continue;
      }
      if (char === '\\') {
        escaping = true;
        continue;
      }
      if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === opener) {
      depth += 1;
      continue;
    }
    if (char === closer) {
      depth -= 1;
      if (depth === 0) {
        return text.slice(startIndex, index + 1);
      }
    }
  }

  return null;
}

/**
 * @param {string} text
 * @returns {string | null}
 */
function extractAuthoritativeJsonBlock(text) {
  /** @type {{ candidate: string; startIndex: number; endIndex: number; trailingNonWhitespaceLength: number } | null} */
  let best = null;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char !== '{' && char !== '[') continue;

    const candidate = extractBalancedJsonBlock(text, index);
    if (!candidate) continue;

    try {
      JSON.parse(candidate);
    } catch {
      continue;
    }

    const endIndex = index + candidate.length;
    const trailingNonWhitespaceLength = text.slice(endIndex).trim().length;
    if (
      !best
      || trailingNonWhitespaceLength < best.trailingNonWhitespaceLength
      || (
        trailingNonWhitespaceLength === best.trailingNonWhitespaceLength
        && (
          endIndex > best.endIndex
          || (endIndex === best.endIndex && index < best.startIndex)
        )
      )
    ) {
      best = { candidate, startIndex: index, endIndex, trailingNonWhitespaceLength };
    }
  }

  return best?.candidate ?? null;
}

/**
 * @param {string} raw
 * @param {string} label
 * @returns {any}
 */
export function parseEasJsonCommandOutput(raw, label) {
  const text = String(raw ?? '').trim();
  if (!text) {
    throw new SyntaxError(`Expected JSON from ${label}, received empty output.`);
  }

  try {
    return JSON.parse(text);
  } catch {
    const candidate = extractAuthoritativeJsonBlock(text);
    if (candidate) {
      return JSON.parse(candidate);
    }
  }

  throw new SyntaxError(`Expected JSON from ${label}, received: ${text}`);
}
