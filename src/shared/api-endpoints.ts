function trimSlashes(value: string): string {
  return value.replace(/^\/+/, '').replace(/\/+$/, '');
}

function collapseTrailingDuplicateV1(segments: string[]): string[] {
  const normalized = [...segments];
  while (
    normalized.length >= 2 &&
    normalized[normalized.length - 1].toLowerCase() === 'v1' &&
    normalized[normalized.length - 2].toLowerCase() === 'v1'
  ) {
    normalized.pop();
  }
  return normalized;
}

/**
 * Build a full API endpoint URL from a base URL and endpoint path.
 * The helper keeps a user-supplied endpoint intact and avoids double-appending
 * `/chat/completions` when the base URL already includes it.
 */
export function buildApiEndpointUrl(baseURL: string, endpointPath: string): string {
  const endpoint = trimSlashes(endpointPath);
  const trimmedBase = baseURL.trim().replace(/\/+$/, '');

  if (!trimmedBase) {
    return `/${endpoint}`;
  }

  try {
    const url = new URL(trimmedBase);
    const endpointSegments = endpoint.split('/').filter(Boolean);
    const endpointLower = endpointSegments.join('/').toLowerCase();
    let segments = url.pathname.split('/').filter(Boolean);
    const tail = segments.slice(-endpointSegments.length).join('/').toLowerCase();

    if (tail === endpointLower) {
      if (endpointLower === 'chat/completions') {
        const prefix = collapseTrailingDuplicateV1(segments.slice(0, -endpointSegments.length));
        url.pathname = '/' + [...prefix, ...endpointSegments].join('/');
      } else {
        url.pathname = '/' + segments.join('/');
      }
      return url.toString();
    }

    if (endpointLower === 'chat/completions') {
      segments = collapseTrailingDuplicateV1(segments);
    }

    url.pathname = '/' + [...segments, ...endpointSegments].join('/');
    return url.toString();
  } catch {
    if (trimmedBase.toLowerCase().endsWith('/' + endpoint.toLowerCase())) {
      return trimmedBase;
    }
    return `${trimmedBase}/${endpoint}`;
  }
}

export function buildChatCompletionsUrl(baseURL: string): string {
  return buildApiEndpointUrl(baseURL, 'chat/completions');
}
