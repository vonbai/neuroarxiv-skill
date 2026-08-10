import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSearchQuery,
  createArxivGateway,
  parseEntries,
} from "../src/arxiv.ts";

test("buildSearchQuery combines category and OR'd terms", () => {
  const q = buildSearchQuery("cs.DB", ["cache invalidation", "consistency"]);
  assert.equal(q, 'cat:cs.DB AND (all:"cache invalidation" OR all:consistency)');
});

test("buildSearchQuery with no terms is category-only", () => {
  assert.equal(buildSearchQuery("cs.AI", []), "cat:cs.AI");
});

test("buildSearchQuery pushes the submitted-date window into arXiv", () => {
  const now = Date.UTC(2026, 7, 11, 12);
  assert.equal(
    buildSearchQuery("cs.DB", ["cache invalidation"], 2, now),
    'cat:cs.DB AND (all:"cache invalidation") AND submittedDate:[202408110000 TO 202608112359]',
  );
});

// Real fixture captured from https://export.arxiv.org/api/query
const FIXTURE_XML = `<?xml version='1.0' encoding='UTF-8'?>
<feed xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/" xmlns:arxiv="http://arxiv.org/schemas/atom" xmlns="http://www.w3.org/2005/Atom">
  <id>https://arxiv.org/api/NrKvU5JyMjMoyw2dftxBb5HiPF4</id>
  <title>arXiv Query: search_query=cat:cs.AI AND all:semantic OR all:cache&amp;id_list=&amp;start=0&amp;max_results=1</title>
  <updated>2026-08-05T09:42:58Z</updated>
  <opensearch:totalResults>21694</opensearch:totalResults>
  <opensearch:startIndex>0</opensearch:startIndex>
  <entry>
    <id>http://arxiv.org/abs/0807.4618v1</id>
    <updated>2008-07-29T09:54:44Z</updated>
    <published>2008-07-29T09:54:44Z</published>
    <title>AceWiki: A Natural and Expressive Semantic Wiki</title>
    <summary>  We present AceWiki, a prototype of a new kind of semantic wiki using the
controlled natural language Attempto Controlled English (ACE) &amp; more, for
representing its content.
</summary>
    <author>
      <name>Kaarel Kaljurand</name>
    </author>
    <author>
      <name>Norbert E. Fuchs</name>
    </author>
    <link href="https://arxiv.org/abs/0807.4618v1" rel="alternate" type="text/html"/>
    <link title="pdf" href="https://arxiv.org/pdf/0807.4618v1" rel="related" type="application/pdf"/>
  </entry>
</feed>`;

test("parseEntries extracts bare id, version, title, authors, links from a real Atom fixture", () => {
  const papers = parseEntries(FIXTURE_XML, "cs.AI");
  assert.equal(papers.length, 1);

  const p = papers[0];
  assert.equal(p.id, "0807.4618");
  assert.equal(p.version, "0807.4618v1");
  assert.equal(p.title, "AceWiki: A Natural and Expressive Semantic Wiki");
  assert.deepEqual(p.authors, ["Kaarel Kaljurand", "Norbert E. Fuchs"]);
  assert.equal(p.categories.length, 1);
  assert.equal(p.categories[0], "cs.AI");
  assert.equal(p.absUrl, "https://arxiv.org/abs/0807.4618v1");
  assert.equal(p.pdfUrl, "https://arxiv.org/pdf/0807.4618v1");
  assert.equal(p.published, "2008-07-29T09:54:44Z");
  assert.match(p.summary, /^We present AceWiki/);
  // XML entities (&amp;) must be unescaped, not left literal.
  assert.match(p.summary, / & more/);
});

test("parseEntries returns an empty array for a feed with no entries", () => {
  assert.deepEqual(parseEntries("<feed></feed>", "cs.AI"), []);
});

test("gateway serializes concurrent searches and applies the courtesy interval", async () => {
  let now = Date.UTC(2026, 7, 11);
  const sleeps: number[] = [];
  const requested: string[] = [];
  const gateway = createArxivGateway({
    now: () => now,
    requestDelayMs: 3000,
    sleep: async (ms) => {
      sleeps.push(ms);
      now += ms;
    },
    fetch: async (input) => {
      requested.push(String(input));
      return new Response("<feed></feed>", { status: 200 });
    },
  });

  await Promise.all([
    gateway.search({ category: "cs.AI", terms: ["agents"], maxResults: 4, sinceYears: 0 }),
    gateway.search({ category: "cs.DB", terms: ["indexes"], maxResults: 4, sinceYears: 0 }),
  ]);

  assert.equal(requested.length, 2);
  assert.deepEqual(sleeps, [3000]);
});

test("gateway retries throttling once with a fresh request", async () => {
  let requests = 0;
  const gateway = createArxivGateway({
    requestDelayMs: 0,
    sleep: async () => undefined,
    fetch: async () => {
      requests += 1;
      if (requests === 1) {
        return new Response("busy", {
          status: 429,
          headers: { "retry-after": "0" },
        });
      }
      return new Response("<feed></feed>", { status: 200 });
    },
  });

  await gateway.search({
    category: "cs.AI",
    terms: ["agents"],
    maxResults: 4,
    sinceYears: 0,
  });
  assert.equal(requests, 2);
});
