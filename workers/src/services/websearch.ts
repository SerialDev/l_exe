/**
 * Web Search Service
 * Provides web search capabilities for AI agents using various search providers.
 * 
 * Supported providers:
 * - Serper (Google Search API) - serper.dev
 * - SearXNG (Self-hosted metasearch)
 * - Brave Search API
 * - Tavily (AI-optimized search)
 */

// =============================================================================
// Types
// =============================================================================

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  publishedDate?: string;
  source?: string;
  position?: number;
}

export interface ImageResult {
  title: string;
  url: string;
  thumbnailUrl?: string;
  sourceUrl: string;
  width?: number;
  height?: number;
}

export interface NewsResult {
  title: string;
  url: string;
  snippet: string;
  publishedDate: string;
  source: string;
  imageUrl?: string;
}

export interface SearchResponse {
  query: string;
  provider: string;
  organic: SearchResult[];
  images?: ImageResult[];
  news?: NewsResult[];
  answerBox?: {
    title?: string;
    answer?: string;
    snippet?: string;
    source?: string;
    url?: string;
  };
  knowledgeGraph?: {
    title?: string;
    type?: string;
    description?: string;
    imageUrl?: string;
    attributes?: Record<string, string>;
  };
  searchTime?: number;
  totalResults?: number;
}

export interface SearchOptions {
  numResults?: number;
  page?: number;
  country?: string;
  language?: string;
  safeSearch?: boolean;
  timeRange?: 'day' | 'week' | 'month' | 'year';
  includeImages?: boolean;
  includeNews?: boolean;
}

export type SearchProvider = 'serper' | 'searxng' | 'brave' | 'tavily';

export interface WebSearchConfig {
  provider: SearchProvider;
  apiKey?: string;
  baseUrl?: string; // For self-hosted SearXNG
  defaultNumResults?: number;
}

// =============================================================================
// Serper Provider (Google Search)
// =============================================================================

interface SerperResponse {
  searchParameters: {
    q: string;
    gl?: string;
    hl?: string;
    num?: number;
  };
  organic: Array<{
    title: string;
    link: string;
    snippet: string;
    date?: string;
    position: number;
  }>;
  answerBox?: {
    title?: string;
    answer?: string;
    snippet?: string;
    snippetHighlighted?: string[];
    link?: string;
  };
  knowledgeGraph?: {
    title?: string;
    type?: string;
    description?: string;
    imageUrl?: string;
    attributes?: Record<string, string>;
  };
  images?: Array<{
    title: string;
    imageUrl: string;
    thumbnailUrl?: string;
    link: string;
    imageWidth?: number;
    imageHeight?: number;
  }>;
  news?: Array<{
    title: string;
    link: string;
    snippet: string;
    date: string;
    source: string;
    imageUrl?: string;
  }>;
}

async function searchWithSerper(
  query: string,
  apiKey: string,
  options: SearchOptions = {}
): Promise<SearchResponse> {
  const {
    numResults = 10,
    country = 'us',
    language = 'en',
    timeRange,
  } = options;

  const body: Record<string, unknown> = {
    q: query,
    gl: country,
    hl: language,
    num: numResults,
  };

  if (timeRange) {
    const timeRangeMap: Record<string, string> = {
      day: 'd',
      week: 'w',
      month: 'm',
      year: 'y',
    };
    body.tbs = `qdr:${timeRangeMap[timeRange]}`;
  }

  const response = await fetch('https://google.serper.dev/search', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-KEY': apiKey,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`Serper API error: ${response.status} ${await response.text()}`);
  }

  const data = await response.json() as SerperResponse;

  return {
    query,
    provider: 'serper',
    organic: data.organic.map((r) => ({
      title: r.title,
      url: r.link,
      snippet: r.snippet,
      publishedDate: r.date,
      position: r.position,
    })),
    images: data.images?.map((i) => ({
      title: i.title,
      url: i.imageUrl,
      thumbnailUrl: i.thumbnailUrl,
      sourceUrl: i.link,
      width: i.imageWidth,
      height: i.imageHeight,
    })),
    news: data.news?.map((n) => ({
      title: n.title,
      url: n.link,
      snippet: n.snippet,
      publishedDate: n.date,
      source: n.source,
      imageUrl: n.imageUrl,
    })),
    answerBox: data.answerBox
      ? {
          title: data.answerBox.title,
          answer: data.answerBox.answer,
          snippet: data.answerBox.snippet,
          url: data.answerBox.link,
        }
      : undefined,
    knowledgeGraph: data.knowledgeGraph
      ? {
          title: data.knowledgeGraph.title,
          type: data.knowledgeGraph.type,
          description: data.knowledgeGraph.description,
          imageUrl: data.knowledgeGraph.imageUrl,
          attributes: data.knowledgeGraph.attributes,
        }
      : undefined,
  };
}

// =============================================================================
// SearXNG Provider (Self-hosted)
// =============================================================================

interface SearXNGResponse {
  query: string;
  results: Array<{
    title: string;
    url: string;
    content: string;
    publishedDate?: string;
    engine: string;
    score?: number;
    category?: string;
    img_src?: string;
    thumbnail_src?: string;
  }>;
  number_of_results?: number;
}

async function searchWithSearXNG(
  query: string,
  baseUrl: string,
  options: SearchOptions = {}
): Promise<SearchResponse> {
  const {
    numResults = 10,
    language = 'en',
    safeSearch = true,
    timeRange,
  } = options;

  const params = new URLSearchParams({
    q: query,
    format: 'json',
    language,
    safesearch: safeSearch ? '1' : '0',
  });

  if (timeRange) {
    params.set('time_range', timeRange);
  }

  const response = await fetch(`${baseUrl}/search?${params.toString()}`);

  if (!response.ok) {
    throw new Error(`SearXNG error: ${response.status} ${await response.text()}`);
  }

  const data = await response.json() as SearXNGResponse;

  // Separate organic results from images
  const organic: SearchResult[] = [];
  const images: ImageResult[] = [];

  for (const result of data.results.slice(0, numResults)) {
    if (result.category === 'images' && result.img_src) {
      images.push({
        title: result.title,
        url: result.img_src,
        thumbnailUrl: result.thumbnail_src,
        sourceUrl: result.url,
      });
    } else {
      organic.push({
        title: result.title,
        url: result.url,
        snippet: result.content,
        publishedDate: result.publishedDate,
        source: result.engine,
      });
    }
  }

  return {
    query,
    provider: 'searxng',
    organic,
    images: images.length > 0 ? images : undefined,
    totalResults: data.number_of_results,
  };
}

// =============================================================================
// Brave Search Provider
// =============================================================================

interface BraveSearchResponse {
  query: {
    original: string;
  };
  web?: {
    results: Array<{
      title: string;
      url: string;
      description: string;
      age?: string;
      language?: string;
    }>;
  };
  news?: {
    results: Array<{
      title: string;
      url: string;
      description: string;
      age: string;
      source: {
        name: string;
      };
      thumbnail?: {
        src: string;
      };
    }>;
  };
  infobox?: {
    title?: string;
    type?: string;
    description?: string;
    thumbnail?: {
      src: string;
    };
    attributes?: Array<{
      label: string;
      value: string;
    }>;
  };
}

async function searchWithBrave(
  query: string,
  apiKey: string,
  options: SearchOptions = {}
): Promise<SearchResponse> {
  const {
    numResults = 10,
    country = 'us',
    language = 'en',
    safeSearch = true,
    timeRange,
  } = options;

  const params = new URLSearchParams({
    q: query,
    count: numResults.toString(),
    country,
    search_lang: language,
    safesearch: safeSearch ? 'moderate' : 'off',
  });

  if (timeRange) {
    const freshnessMap: Record<string, string> = {
      day: 'pd',
      week: 'pw',
      month: 'pm',
      year: 'py',
    };
    params.set('freshness', freshnessMap[timeRange]);
  }

  const response = await fetch(`https://api.search.brave.com/res/v1/web/search?${params.toString()}`, {
    headers: {
      'Accept': 'application/json',
      'X-Subscription-Token': apiKey,
    },
  });

  if (!response.ok) {
    throw new Error(`Brave Search API error: ${response.status} ${await response.text()}`);
  }

  const data = await response.json() as BraveSearchResponse;

  return {
    query,
    provider: 'brave',
    organic: (data.web?.results || []).map((r, index) => ({
      title: r.title,
      url: r.url,
      snippet: r.description,
      publishedDate: r.age,
      position: index + 1,
    })),
    news: data.news?.results.map((n) => ({
      title: n.title,
      url: n.url,
      snippet: n.description,
      publishedDate: n.age,
      source: n.source.name,
      imageUrl: n.thumbnail?.src,
    })),
    knowledgeGraph: data.infobox
      ? {
          title: data.infobox.title,
          type: data.infobox.type,
          description: data.infobox.description,
          imageUrl: data.infobox.thumbnail?.src,
          attributes: data.infobox.attributes?.reduce(
            (acc, attr) => ({ ...acc, [attr.label]: attr.value }),
            {} as Record<string, string>
          ),
        }
      : undefined,
  };
}

// =============================================================================
// Tavily Provider (AI-optimized search)
// =============================================================================

interface TavilyResponse {
  query: string;
  results: Array<{
    title: string;
    url: string;
    content: string;
    raw_content?: string;
    score: number;
    published_date?: string;
  }>;
  answer?: string;
  images?: Array<{
    url: string;
    description?: string;
  }>;
  response_time: number;
}

async function searchWithTavily(
  query: string,
  apiKey: string,
  options: SearchOptions = {}
): Promise<SearchResponse> {
  const {
    numResults = 10,
    includeImages = false,
  } = options;

  const body = {
    query,
    search_depth: 'advanced',
    max_results: numResults,
    include_images: includeImages,
    include_answer: true,
  };

  const response = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`Tavily API error: ${response.status} ${await response.text()}`);
  }

  const data = await response.json() as TavilyResponse;

  return {
    query,
    provider: 'tavily',
    organic: data.results.map((r, index) => ({
      title: r.title,
      url: r.url,
      snippet: r.content,
      publishedDate: r.published_date,
      position: index + 1,
    })),
    images: data.images?.map((i) => ({
      title: i.description || '',
      url: i.url,
      sourceUrl: i.url,
    })),
    answerBox: data.answer
      ? {
          answer: data.answer,
        }
      : undefined,
    searchTime: data.response_time,
  };
}

// =============================================================================
// Web Search Service Class
// =============================================================================

export class WebSearchService {
  private config: WebSearchConfig;

  constructor(config: WebSearchConfig) {
    this.config = config;
  }

  /**
   * Perform a web search using the configured provider
   */
  async search(query: string, options: SearchOptions = {}): Promise<SearchResponse> {
    const { provider, apiKey, baseUrl, defaultNumResults } = this.config;

    const mergedOptions: SearchOptions = {
      numResults: defaultNumResults || 10,
      ...options,
    };

    switch (provider) {
      case 'serper':
        if (!apiKey) throw new Error('Serper API key is required');
        return searchWithSerper(query, apiKey, mergedOptions);

      case 'searxng':
        if (!baseUrl) throw new Error('SearXNG base URL is required');
        return searchWithSearXNG(query, baseUrl, mergedOptions);

      case 'brave':
        if (!apiKey) throw new Error('Brave Search API key is required');
        return searchWithBrave(query, apiKey, mergedOptions);

      case 'tavily':
        if (!apiKey) throw new Error('Tavily API key is required');
        return searchWithTavily(query, apiKey, mergedOptions);

      default:
        throw new Error(`Unknown search provider: ${provider}`);
    }
  }

  /**
   * Search for images
   */
  async searchImages(query: string, options: SearchOptions = {}): Promise<ImageResult[]> {
    const results = await this.search(query, { ...options, includeImages: true });
    return results.images || [];
  }

  /**
   * Search for news
   */
  async searchNews(query: string, options: SearchOptions = {}): Promise<NewsResult[]> {
    const results = await this.search(query, { ...options, includeNews: true });
    return results.news || [];
  }

  /**
   * Get a direct answer (if available from provider)
   */
  async getAnswer(query: string): Promise<string | null> {
    const results = await this.search(query, { numResults: 5 });
    return results.answerBox?.answer || results.answerBox?.snippet || null;
  }

  /**
   * Format search results as context for AI prompts
   */
  formatAsContext(results: SearchResponse, maxResults: number = 5): string {
    const lines: string[] = [];
    lines.push(`Web search results for: "${results.query}"\n`);

    // Include answer box if available
    if (results.answerBox?.answer) {
      lines.push(`Direct Answer: ${results.answerBox.answer}\n`);
    }

    // Include knowledge graph if available
    if (results.knowledgeGraph) {
      lines.push('Knowledge Graph:');
      if (results.knowledgeGraph.title) {
        lines.push(`  Title: ${results.knowledgeGraph.title}`);
      }
      if (results.knowledgeGraph.type) {
        lines.push(`  Type: ${results.knowledgeGraph.type}`);
      }
      if (results.knowledgeGraph.description) {
        lines.push(`  Description: ${results.knowledgeGraph.description}`);
      }
      lines.push('');
    }

    // Include organic results
    const organic = results.organic.slice(0, maxResults);
    if (organic.length > 0) {
      lines.push('Search Results:');
      for (const [index, result] of organic.entries()) {
        lines.push(`\n[${index + 1}] ${result.title}`);
        lines.push(`    URL: ${result.url}`);
        lines.push(`    ${result.snippet}`);
        if (result.publishedDate) {
          lines.push(`    Published: ${result.publishedDate}`);
        }
      }
    }

    return lines.join('\n');
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create a web search service instance
 */
export function createWebSearchService(config: WebSearchConfig): WebSearchService {
  return new WebSearchService(config);
}

/**
 * Create web search service from environment
 */
export function createWebSearchServiceFromEnv(env: {
  SEARCH_PROVIDER?: string;
  SERPER_API_KEY?: string;
  SEARXNG_URL?: string;
  BRAVE_SEARCH_API_KEY?: string;
  TAVILY_API_KEY?: string;
}): WebSearchService | null {
  const provider = (env.SEARCH_PROVIDER || 'serper') as SearchProvider;

  switch (provider) {
    case 'serper':
      if (env.SERPER_API_KEY) {
        return new WebSearchService({
          provider: 'serper',
          apiKey: env.SERPER_API_KEY,
        });
      }
      break;

    case 'searxng':
      if (env.SEARXNG_URL) {
        return new WebSearchService({
          provider: 'searxng',
          baseUrl: env.SEARXNG_URL,
        });
      }
      break;

    case 'brave':
      if (env.BRAVE_SEARCH_API_KEY) {
        return new WebSearchService({
          provider: 'brave',
          apiKey: env.BRAVE_SEARCH_API_KEY,
        });
      }
      break;

    case 'tavily':
      if (env.TAVILY_API_KEY) {
        return new WebSearchService({
          provider: 'tavily',
          apiKey: env.TAVILY_API_KEY,
        });
      }
      break;
  }

  return null;
}
