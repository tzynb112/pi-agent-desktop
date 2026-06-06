/**
 * JSON Healing — Fuzzy JSON repair for malformed LLM tool call arguments.
 * Handles common LLM output issues: missing commas, unescaped newlines,
 * trailing commas, unclosed brackets, single quotes, etc.
 */

/**
 * Attempt to repair a malformed JSON string.
 * Returns the parsed object if repair succeeds, or null if unrepairable.
 */
export function tryParseJson(raw: string): { parsed: any; repaired: boolean } {
  // Fast path: try standard parse first
  try {
    return { parsed: JSON.parse(raw), repaired: false };
  } catch {
    // Continue to repair attempts
  }

  const repaired = repairJson(raw);
  if (repaired !== null) {
    try {
      return { parsed: JSON.parse(repaired), repaired: true };
    } catch {
      // Repair didn't produce valid JSON
    }
  }

  return { parsed: null, repaired: false };
}

/**
 * Attempt to repair a malformed JSON string.
 * Returns the repaired string, or null if unrepairable.
 */
export function repairJson(raw: string): string | null {
  if (!raw || typeof raw !== 'string') return null;

  let s = raw.trim();

  // 1. Strip markdown code fences
  s = s.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '');

  // 2. Extract JSON object/array from surrounding text
  const objStart = s.indexOf('{');
  const arrStart = s.indexOf('[');
  let start = -1;
  let isArray = false;

  if (objStart === -1 && arrStart === -1) return null;

  if (objStart !== -1 && (arrStart === -1 || objStart < arrStart)) {
    start = objStart;
    isArray = false;
  } else {
    start = arrStart;
    isArray = true;
  }

  s = s.substring(start);

  // 3. Remove trailing content after the matching closing bracket
  const closeChar = isArray ? ']' : '}';
  let depth = 0;
  let inString = false;
  let escape = false;
  let end = -1;

  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === '\\' && inString) {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (ch === '{' || ch === '[') depth++;
    if (ch === '}' || ch === ']') {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }

  if (end !== -1) {
    s = s.substring(0, end + 1);
  }

  // 4. Fix common issues

  // Single quotes → double quotes (simple cases only)
  // Only do this if there are no double quotes at all (likely the whole thing uses single quotes)
  if (!s.includes('"') && s.includes("'")) {
    s = s.replace(/'/g, '"');
  }

  // Remove trailing commas before } or ]
  s = s.replace(/,(\s*[}\]])/g, '$1');

  // Fix unescaped newlines inside strings
  s = fixUnescapedNewlines(s);

  // Fix unescaped tabs inside strings
  s = s.replace(/(?<="[^"]*?)(\t)(?=[^"]*?")/g, '\\t');

  // 5. Try to close unclosed brackets
  try {
    JSON.parse(s);
    return s;
  } catch {
    // Continue
  }

  // Count unclosed brackets and try to close them
  let openBraces = 0;
  let openBrackets = 0;
  inString = false;
  escape = false;

  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === '\\' && inString) {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (ch === '{') openBraces++;
    if (ch === '}') openBraces--;
    if (ch === '[') openBrackets++;
    if (ch === ']') openBrackets--;
  }

  // Close any unclosed strings
  if (inString) {
    s += '"';
  }

  // Remove trailing commas again (in case we added a closing quote)
  s = s.replace(/,(\s*[}\]])/g, '$1');

  // Close unclosed brackets
  while (openBrackets > 0) {
    s += ']';
    openBrackets--;
  }
  while (openBraces > 0) {
    s += '}';
    openBraces--;
  }

  // Final validation
  try {
    JSON.parse(s);
    return s;
  } catch {
    return null;
  }
}

/**
 * Fix unescaped newlines inside JSON string values.
 * Preserves newlines that are already properly escaped.
 */
function fixUnescapedNewlines(s: string): string {
  const result: string[] = [];
  let inString = false;
  let escape = false;

  for (let i = 0; i < s.length; i++) {
    const ch = s[i];

    if (escape) {
      escape = false;
      result.push(ch);
      continue;
    }

    if (ch === '\\' && inString) {
      escape = true;
      result.push(ch);
      continue;
    }

    if (ch === '"') {
      inString = !inString;
      result.push(ch);
      continue;
    }

    if (inString && ch === '\n') {
      result.push('\\n');
      continue;
    }

    if (inString && ch === '\r') {
      result.push('\\r');
      continue;
    }

    result.push(ch);
  }

  return result.join('');
}
