import type {
  Paper,
  RetrievalFailure,
  RetrievalRequestTrace,
} from "./types.js";

const ARXIV_API = "https://export.arxiv.org/api/query";
const DEFAULT_REQUEST_DELAY_MS = 3000;
const DEFAULT_REQUEST_TIMEOUT_MS = 20_000;
const DEFAULT_RETRIEVAL_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_RETRIES = 1;
const USER_AGENT =
  "neuroarxiv-skill/0.5.0 (+https://github.com/vonbai/neuroarxiv-skill)";

type FetchLike = typeof fetch;

export type ArxivSearch = {
  category: string;
  terms: string[];
  maxResults: number;
  sinceYears: number;
};

export type ArxivGateway = {
  search(input: ArxivSearch): Promise<ArxivSearchOutcome>;
};

export type ArxivSearchOutcome =
  | {
      status: "succeeded";
      papers: Paper[];
      requests: RetrievalRequestTrace[];
    }
  | {
      status: "failed";
      failure: RetrievalFailure;
      requests: RetrievalRequestTrace[];
    };

export type ArxivGatewayOptions = {
  fetch?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  requestDelayMs?: number;
  requestTimeoutMs?: number;
  retrievalTimeoutMs?: number;
  maxRetries?: number;
};

class RetrievalDeadlineError extends Error {
  constructor() {
    super("Research Evidence retrieval deadline exhausted");
    this.name = "RetrievalDeadlineError";
  }
}

class InvalidAtomResponseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidAtomResponseError";
  }
}

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

function extractCategories(block: string): string[] {
  return [...block.matchAll(/<category\b[^>]*\/?\s*>/g)]
    .map((match) => parseAttrs(match[0]).term)
    .filter((term): term is string => Boolean(term));
}

function requiredTag(entry: string, tag: string): string {
  const value = extractTag(entry, tag);
  if (!value) throw new InvalidAtomResponseError(`arXiv Atom entry is missing required ${tag}`);
  return value;
}

function requiredTimestamp(entry: string, tag: string): string {
  const value = requiredTag(entry, tag);
  if (Number.isNaN(Date.parse(value))) {
    throw new InvalidAtomResponseError(`arXiv Atom entry has invalid ${tag}`);
  }
  return value;
}

export function parseEntries(xml: string, searchedCategory: string): Paper[] {
  const feedStarts = xml.match(/<feed(?:\s[^>]*)?>/gi) ?? [];
  const feedEnds = xml.match(/<\/feed\s*>/gi) ?? [];
  if (
    feedStarts.length !== 1 ||
    feedEnds.length !== 1 ||
    !/<\/feed\s*>\s*$/i.test(xml)
  ) {
    throw new InvalidAtomResponseError("arXiv API returned a non-Atom response");
  }
  const entryStarts = xml.match(/<entry(?:\s[^>]*)?>/gi) ?? [];
  const entryEnds = xml.match(/<\/entry\s*>/gi) ?? [];
  const entries = xml.match(/<entry(?:\s[^>]*)?>[\s\S]*?<\/entry\s*>/gi) ?? [];
  if (entryStarts.length !== entryEnds.length || entries.length !== entryStarts.length) {
    throw new InvalidAtomResponseError("arXiv API returned a malformed Atom entry");
  }
  return entries.map((entry) => {
    const idUrl = requiredTag(entry, "id");
    const version = idUrl.match(/^https?:\/\/(?:www\.)?arxiv\.org\/abs\/(.+)$/i)?.[1];
    if (!version || !/v\d+$/.test(version)) {
      throw new InvalidAtomResponseError("arXiv Atom entry has invalid versioned id");
    }
    const id = version.replace(/v\d+$/, "");
    const title = requiredTag(entry, "title").replace(/\s+/g, " ").trim();
    const summary = requiredTag(entry, "summary")
      .replace(/\s+/g, " ")
      .trim();
    const authors = [...entry.matchAll(/<author>\s*<name>([\s\S]*?)<\/name>/g)].map(
      (match) => xmlUnescape(match[1]).trim(),
    ).filter(Boolean);
    if (authors.length === 0) {
      throw new InvalidAtomResponseError("arXiv Atom entry is missing required author");
    }
    const categories = [searchedCategory, ...extractCategories(entry)];

    return {
      id,
      version,
      title,
      summary,
      authors,
      categories: [...new Set(categories)],
      published: requiredTimestamp(entry, "published"),
      updated: requiredTimestamp(entry, "updated"),
      absUrl: `https://arxiv.org/abs/${version}`,
      pdfUrl: `https://arxiv.org/pdf/${version}`,
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
  const retrievalTimeoutMs = options.retrievalTimeoutMs ?? DEFAULT_RETRIEVAL_TIMEOUT_MS;
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  const deadlineAt = now() + retrievalTimeoutMs;
  const cache = new Map<string, Promise<ArxivSearchOutcome>>();

  let requestQueue = Promise.resolve();
  let nextRequestAt = 0;

  function remainingMs(): number {
    return Math.max(0, deadlineAt - now());
  }

  async function sleepWithinDeadline(ms: number): Promise<void> {
    if (ms >= remainingMs()) throw new RetrievalDeadlineError();
    if (ms > 0) await sleep(ms);
  }

  async function schedule<T>(task: () => Promise<T>): Promise<T> {
    const run = requestQueue.then(async () => {
      const waitMs = Math.max(0, nextRequestAt - now());
      await sleepWithinDeadline(waitMs);
      nextRequestAt = now() + requestDelayMs;
      return task();
    });
    requestQueue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  function deadlineFailure(): RetrievalFailure {
    return {
      kind: "deadline-exhausted",
      message: "Research Evidence retrieval deadline exhausted",
      retryable: false,
    };
  }

  function transportFailure(error: unknown): RetrievalFailure {
    if (
      (error instanceof DOMException && error.name === "AbortError") ||
      (error instanceof Error && error.name === "AbortError")
    ) {
      return {
        kind: "timeout",
        message: "arXiv request timed out",
        retryable: true,
      };
    }
    return {
      kind: "transport",
      message: error instanceof Error ? error.message : String(error),
      retryable: true,
    };
  }

  function responseFailure(response: Response): RetrievalFailure {
    const retryAfterMs = response.headers.has("retry-after")
      ? retryDelayMs(response, now())
      : undefined;
    if (response.status === 429) {
      return {
        kind: "throttled",
        message: "arXiv API returned 429",
        retryable: true,
        httpStatus: 429,
        ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
      };
    }
    if (response.status >= 500) {
      return {
        kind: "server",
        message: `arXiv API returned ${response.status}`,
        retryable: true,
        httpStatus: response.status,
        ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
      };
    }
    return {
      kind: "request-rejected",
      message: `arXiv API returned ${response.status}`,
      retryable: false,
      httpStatus: response.status,
    };
  }

  function invalidResponseFailure(error: unknown): RetrievalFailure {
    return {
      kind: "invalid-response",
      message:
        error instanceof InvalidAtomResponseError
          ? error.message
          : "arXiv API returned invalid Atom content",
      retryable: false,
    };
  }

  function replaceTerminalSuccess(
    requests: RetrievalRequestTrace[],
    failure: RetrievalFailure,
  ): RetrievalRequestTrace[] {
    const updated = [...requests];
    const terminal = updated.at(-1);
    if (terminal?.status === "succeeded") {
      updated[updated.length - 1] = {
        sequence: terminal.sequence,
        status: "failed",
        failure,
      };
    }
    return updated;
  }

  async function fetchText(
    url: string,
  ): Promise<
    | { status: "succeeded"; text: string; requests: RetrievalRequestTrace[] }
    | { status: "failed"; failure: RetrievalFailure; requests: RetrievalRequestTrace[] }
  > {
    const requests: RetrievalRequestTrace[] = [];
    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      let response: Response;
      let responseText: string | undefined;
      try {
        const received = await schedule(async () => {
          const remaining = remainingMs();
          if (remaining <= 0) throw new RetrievalDeadlineError();
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), Math.min(requestTimeoutMs, remaining));
          try {
            const fetched = await fetchImpl(url, {
              headers: { "User-Agent": USER_AGENT },
              signal: controller.signal,
            });
            return {
              response: fetched,
              text: fetched.ok ? await fetched.text() : undefined,
            };
          } finally {
            clearTimeout(timer);
          }
        });
        response = received.response;
        responseText = received.text;
      } catch (error) {
        if (error instanceof RetrievalDeadlineError) {
          return { status: "failed", failure: deadlineFailure(), requests };
        }
        const failure = transportFailure(error);
        requests.push({ sequence: attempt + 1, status: "failed", failure });
        if (!failure.retryable || attempt === maxRetries) {
          return { status: "failed", failure, requests };
        }
        try {
          await sleepWithinDeadline(5000);
        } catch (deadlineError) {
          if (deadlineError instanceof RetrievalDeadlineError) {
            return { status: "failed", failure: deadlineFailure(), requests };
          }
          throw deadlineError;
        }
        continue;
      }

      if (response.ok) {
        if (responseText === undefined || !/<feed(?:\s|>)/i.test(responseText)) {
          const failure: RetrievalFailure = {
            kind: "invalid-response",
            message: "arXiv API returned a non-Atom response",
            retryable: false,
          };
          requests.push({ sequence: attempt + 1, status: "failed", failure });
          return { status: "failed", failure, requests };
        }
        requests.push({ sequence: attempt + 1, status: "succeeded" });
        return { status: "succeeded", text: responseText, requests };
      }
      const failure = responseFailure(response);
      requests.push({ sequence: attempt + 1, status: "failed", failure });
      if (!failure.retryable || attempt === maxRetries) {
        return { status: "failed", failure, requests };
      }
      const delayMs = failure.retryAfterMs ?? 5000;
      try {
        await sleepWithinDeadline(delayMs);
      } catch (deadlineError) {
        if (deadlineError instanceof RetrievalDeadlineError) {
          return { status: "failed", failure: deadlineFailure(), requests };
        }
        throw deadlineError;
      }
    }
    return { status: "failed", failure: deadlineFailure(), requests };
  }

  async function search(input: ArxivSearch): Promise<ArxivSearchOutcome> {
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

    const pending = fetchText(url).then((result): ArxivSearchOutcome => {
      if (result.status === "failed") return result;
      try {
        return {
          status: "succeeded",
          papers: parseEntries(result.text, input.category),
          requests: result.requests,
        };
      } catch (error) {
        const failure = invalidResponseFailure(error);
        return {
          status: "failed",
          failure,
          requests: replaceTerminalSuccess(result.requests, failure),
        };
      }
    });
    cache.set(url, pending);
    return pending;
  }

  return { search };
}
