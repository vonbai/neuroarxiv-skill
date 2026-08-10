import type { Paper } from "./types.js";

const ARXIV_API = "https://export.arxiv.org/api/query";
const DEFAULT_REQUEST_DELAY_MS = 3000;
const DEFAULT_REQUEST_TIMEOUT_MS = 20_000;
const DEFAULT_MAX_RETRIES = 1;
const USER_AGENT =
  "neuroarxiv-skill/0.2 (+https://github.com/vonbai/neuroarxiv-skill)";

type FetchLike = typeof fetch;

export type ArxivSearch = {
  category: string;
  terms: string[];
  maxResults: number;
  sinceYears: number;
};

export type ArxivGateway = {
  search(input: ArxivSearch): Promise<Paper[]>;
};

export type ArxivGatewayOptions = {
  fetch?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  requestDelayMs?: number;
  requestTimeoutMs?: number;
  maxRetries?: number;
};

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function xmlUnescape(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function extractTag(block: string, tag: string): string | undefined {
  const match = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
  return match ? xmlUnescape(match[1]).trim() : undefined;
}

function parseAttrs(tag: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const match of tag.matchAll(/([\w:-]+)="([^"]*)"/g)) {
    attrs[match[1]] = xmlUnescape(match[2]);
  }
  return attrs;
}

function extractLinks(block: string): Record<string, string>[] {
  return [...block.matchAll(/<link\b[^>]*\/?\s*>/g)].map((match) =>
    parseAttrs(match[0]),
  );
}

function extractCategories(block: string): string[] {
  return [...block.matchAll(/<category\b[^>]*\/?\s*>/g)]
    .map((match) => parseAttrs(match[0]).term)
    .filter((term): term is string => Boolean(term));
}

export function parseEntries(xml: string, searchedCategory: string): Paper[] {
  const entries = xml.match(/<entry>[\s\S]*?<\/entry>/g) ?? [];
  return entries.map((entry) => {
    const idUrl = extractTag(entry, "id") ?? "";
    const version = idUrl.match(/abs\/([^/]+)$/)?.[1] ?? idUrl;
    const id = version.replace(/v\d+$/, "");
    const title = (extractTag(entry, "title") ?? "").replace(/\s+/g, " ").trim();
    const summary = (extractTag(entry, "summary") ?? "")
      .replace(/\s+/g, " ")
      .trim();
    const authors = [...entry.matchAll(/<author>\s*<name>([\s\S]*?)<\/name>/g)].map(
      (match) => xmlUnescape(match[1]).trim(),
    );
    const links = extractLinks(entry);
    const absUrl = links.find((link) => link.rel === "alternate")?.href ?? idUrl;
    const pdfUrl =
      links.find((link) => link.title === "pdf")?.href ??
      idUrl.replace("/abs/", "/pdf/");
    const categories = [searchedCategory, ...extractCategories(entry)];

    return {
      id,
      version,
      title,
      summary,
      authors,
      categories: [...new Set(categories)],
      published: extractTag(entry, "published") ?? "",
      updated: extractTag(entry, "updated") ?? "",
      absUrl,
      pdfUrl,
    };
  });
}

function termClause(term: string): string {
  const normalized = term.trim().replace(/"/g, "");
  return /\s/.test(normalized) ? `all:"${normalized}"` : `all:${normalized}`;
}

function arxivTimestamp(date: Date, endOfDay: boolean): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}${month}${day}${endOfDay ? "2359" : "0000"}`;
}

function submittedDateClause(sinceYears: number, nowMs: number): string | undefined {
  if (sinceYears <= 0) return undefined;
  const end = new Date(nowMs);
  const start = new Date(nowMs);
  start.setUTCFullYear(start.getUTCFullYear() - sinceYears);
  return `submittedDate:[${arxivTimestamp(start, false)} TO ${arxivTimestamp(end, true)}]`;
}

export function buildSearchQuery(
  category: string,
  terms: string[],
  sinceYears = 0,
  nowMs = Date.now(),
): string {
  const clauses = [`cat:${category}`];
  if (terms.length > 0) {
    clauses.push(`(${terms.map(termClause).join(" OR ")})`);
  }
  const dateClause = submittedDateClause(sinceYears, nowMs);
  if (dateClause) clauses.push(dateClause);
  return clauses.join(" AND ");
}

function retryDelayMs(response: Response, nowMs: number): number {
  const retryAfter = response.headers.get("retry-after");
  if (!retryAfter) return 5000;
  const seconds = Number(retryAfter);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(retryAfter);
  return Number.isNaN(date) ? 5000 : Math.max(0, date - nowMs);
}

function versionNumber(version: string): number {
  return Number(version.match(/v(\d+)$/)?.[1] ?? 0);
}

export function mergePaper(existing: Paper, incoming: Paper): Paper {
  const newest =
    versionNumber(incoming.version) > versionNumber(existing.version) ? incoming : existing;
  return {
    ...newest,
    categories: [...new Set([...existing.categories, ...incoming.categories])],
  };
}

export function createArxivGateway(options: ArxivGatewayOptions = {}): ArxivGateway {
  const fetchImpl = options.fetch ?? fetch;
  const sleep = options.sleep ?? defaultSleep;
  const now = options.now ?? Date.now;
  const requestDelayMs = options.requestDelayMs ?? DEFAULT_REQUEST_DELAY_MS;
  const requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  const cache = new Map<string, Promise<Paper[]>>();

  let requestQueue = Promise.resolve();
  let nextRequestAt = 0;

  async function schedule<T>(task: () => Promise<T>): Promise<T> {
    const run = requestQueue.then(async () => {
      const waitMs = Math.max(0, nextRequestAt - now());
      if (waitMs > 0) await sleep(waitMs);
      nextRequestAt = now() + requestDelayMs;
      return task();
    });
    requestQueue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  async function fetchText(url: string): Promise<string> {
    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      const response = await schedule(async () => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), requestTimeoutMs);
        try {
          return await fetchImpl(url, {
            headers: { "User-Agent": USER_AGENT },
            signal: controller.signal,
          });
        } finally {
          clearTimeout(timer);
        }
      });

      if (response.ok) return response.text();
      const retryable = response.status === 429 || response.status >= 500;
      if (!retryable || attempt === maxRetries) {
        throw new Error(`arXiv API returned ${response.status}`);
      }
      await sleep(retryDelayMs(response, now()));
    }
    throw new Error("arXiv retry budget exhausted");
  }

  async function search(input: ArxivSearch): Promise<Paper[]> {
    const query = buildSearchQuery(
      input.category,
      input.terms,
      input.sinceYears,
      now(),
    );
    const params = new URLSearchParams({
      search_query: query,
      start: "0",
      max_results: String(input.maxResults),
      sortBy: "relevance",
      sortOrder: "descending",
    });
    const url = `${ARXIV_API}?${params.toString()}`;
    const cached = cache.get(url);
    if (cached) return cached;

    const pending = fetchText(url)
      .then((xml) => parseEntries(xml, input.category))
      .catch((error) => {
        cache.delete(url);
        throw error;
      });
    cache.set(url, pending);
    return pending;
  }

  return { search };
}
