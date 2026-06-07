/**
 * Web Scraper — Fetch and clean web pages for LLM consumption.
 * Strips ads, navigation, scripts, styles, and other noise.
 * Returns clean, readable text content.
 */

export interface ScrapeResult {
  success: boolean;
  url: string;
  title?: string;
  content?: string;
  links?: Array<{ text: string; href: string }>;
  error?: string;
}

export interface SearchResult {
  title: string;
  url: string;
  snippet?: string;
}

/**
 * Fetch a URL and return cleaned text content.
 */
export async function scrapeUrl(url: string, options: {
  maxLength?: number;
  extractLinks?: boolean;
  followRedirects?: boolean;
} = {}): Promise<ScrapeResult> {
  const { maxLength = 15000, extractLinks = true, followRedirects = true } = options;

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9,zh-CN;q=0.8',
      },
      redirect: followRedirects ? 'follow' : 'manual',
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      return { success: false, url, error: `HTTP ${response.status}: ${response.statusText}` };
    }

    const html = await response.text();
    const cleaned = cleanHtml(html, { maxLength, extractLinks });

    return {
      success: true,
      url: response.url || url,
      title: cleaned.title,
      content: cleaned.content,
      links: cleaned.links,
    };
  } catch (err: any) {
    return {
      success: false,
      url,
      error: err.message || 'Failed to fetch URL',
    };
  }
}

export async function searchDuckDuckGo(query: string, options: {
  maxResults?: number;
} = {}): Promise<{
  success: boolean;
  query: string;
  url: string;
  results?: SearchResult[];
  error?: string;
}> {
  const maxResults = options.maxResults ?? 5;
  const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;

  try {
    const response = await fetch(searchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9,zh-CN;q=0.8',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      return { success: false, query, url: searchUrl, error: `HTTP ${response.status}: ${response.statusText}` };
    }

    const html = await response.text();
    return {
      success: true,
      query,
      url: response.url || searchUrl,
      results: parseDuckDuckGoSearchResults(html, maxResults),
    };
  } catch (err: any) {
    return {
      success: false,
      query,
      url: searchUrl,
      error: err.message || 'Failed to search DuckDuckGo',
    };
  }
}

interface CleanedHtml {
  title?: string;
  content: string;
  links: Array<{ text: string; href: string }>;
}

/**
 * Clean HTML and extract readable text content.
 */
function cleanHtml(html: string, options: { maxLength: number; extractLinks: boolean }): CleanedHtml {
  let content = html;

  // Extract title
  const titleMatch = content.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? titleMatch[1].trim() : undefined;

  // Remove script, style, nav, footer, header, aside tags and their content
  content = content.replace(/<script[\s\S]*?<\/script>/gi, '');
  content = content.replace(/<style[\s\S]*?<\/style>/gi, '');
  content = content.replace(/<nav[\s\S]*?<\/nav>/gi, '');
  content = content.replace(/<footer[\s\S]*?<\/footer>/gi, '');
  content = content.replace(/<header[\s\S]*?<\/header>/gi, '');
  content = content.replace(/<aside[\s\S]*?<\/aside>/gi, '');
  content = content.replace(/<noscript[\s\S]*?<\/noscript>/gi, '');
  content = content.replace(/<iframe[\s\S]*?<\/iframe>/gi, '');
  content = content.replace(/<svg[\s\S]*?<\/svg>/gi, '');

  // Remove comments
  content = content.replace(/<!--[\s\S]*?-->/g, '');

  // Remove common ad/social elements
  content = content.replace(/<div[^>]*class="[^"]*(?:ad|advertisement|social|share|comment|sidebar|widget|popup|modal|overlay)[^"]*"[\s\S]*?<\/div>/gi, '');

  // Extract links before removing tags
  const links: Array<{ text: string; href: string }> = [];
  if (options.extractLinks) {
    const linkRegex = /<a[^>]+href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
    let linkMatch;
    while ((linkMatch = linkRegex.exec(content)) !== null) {
      const href = linkMatch[1].trim();
      const text = linkMatch[2].replace(/<[^>]+>/g, '').trim();
      if (href && text && !href.startsWith('#') && !href.startsWith('javascript:')) {
        links.push({ text: text.substring(0, 100), href });
      }
    }
  }

  // Replace block elements with newlines
  content = content.replace(/<\/?(?:p|div|h[1-6]|li|tr|blockquote|pre|section|article)[^>]*>/gi, '\n');
  content = content.replace(/<br\s*\/?>/gi, '\n');

  // Remove all remaining HTML tags
  content = content.replace(/<[^>]+>/g, ' ');

  // Decode HTML entities
  content = decodeEntities(content);

  // Clean up whitespace
  content = content.replace(/[ \t]+/g, ' '); // Collapse spaces
  content = content.replace(/\n{3,}/g, '\n\n'); // Collapse newlines
  content = content.replace(/^\s+|\s+$/gm, ''); // Trim each line

  // Remove empty lines at start and end
  content = content.trim();

  // Truncate if needed
  if (content.length > options.maxLength) {
    content = content.substring(0, options.maxLength) + '\n\n[Content truncated...]';
  }

  return { title, content, links: links.slice(0, 30) };
}

export function parseDuckDuckGoSearchResults(html: string, maxResults = 5): SearchResult[] {
  const anchorRegex = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  const anchors: Array<{ href: string; titleHtml: string; end: number; index: number }> = [];
  let match: RegExpExecArray | null;

  while ((match = anchorRegex.exec(html)) !== null) {
    anchors.push({
      href: match[1],
      titleHtml: match[2],
      end: match.index + match[0].length,
      index: match.index,
    });
  }

  const results: SearchResult[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < anchors.length && results.length < maxResults; i++) {
    const anchor = anchors[i];
    const nextStart = anchors[i + 1]?.index ?? html.length;
    const block = html.slice(anchor.end, nextStart);
    const snippetMatch = block.match(/<(?:div|a)[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/(?:div|a)>/i);
    const url = normalizeDuckDuckGoUrl(anchor.href);

    if (!url || !/^https?:\/\//i.test(url) || seen.has(url)) {
      continue;
    }

    seen.add(url);
    results.push({
      title: cleanupSearchText(anchor.titleHtml),
      url,
      snippet: snippetMatch ? cleanupSearchText(snippetMatch[1]) : undefined,
    });
  }

  return results;
}

function normalizeDuckDuckGoUrl(href: string): string {
  const trimmed = href.trim();
  const candidate = trimmed.startsWith('//') ? `https:${trimmed}` : trimmed;

  try {
    const parsed = new URL(candidate, 'https://duckduckgo.com');
    if (parsed.hostname.includes('duckduckgo.com')) {
      const uddg = parsed.searchParams.get('uddg');
      if (uddg) {
        return decodeURIComponent(uddg);
      }
      return '';
    }
    return parsed.toString();
  } catch {
    return candidate;
  }
}

function cleanupSearchText(text: string): string {
  return decodeEntities(text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
}

/**
 * Decode common HTML entities.
 */
function decodeEntities(text: string): string {
  const entities: Record<string, string> = {
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&#39;': "'",
    '&apos;': "'",
    '&nbsp;': ' ',
    '&mdash;': '—',
    '&ndash;': '–',
    '&hellip;': '…',
    '&copy;': '©',
    '&reg;': '®',
    '&trade;': '™',
    '&bull;': '•',
    '&middot;': '·',
    '&lsquo;': '‘',
    '&rsquo;': '’',
    '&ldquo;': '“',
    '&rdquo;': '”',
  };

  let result = text;
  for (const [entity, char] of Object.entries(entities)) {
    result = result.replace(new RegExp(entity.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), char);
  }

  // Decode numeric entities
  result = result.replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code)));
  result = result.replace(/&#x([0-9a-fA-F]+);/g, (_, code) => String.fromCharCode(parseInt(code, 16)));

  return result;
}
