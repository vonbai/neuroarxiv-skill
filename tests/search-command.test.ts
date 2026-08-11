import assert from "node:assert/strict";
import test from "node:test";

import { parseSearch } from "../src/search-command.ts";

test("search CLI preserves category reasons and explicit full-text budget", () => {
  const flags = parseSearch([
    "Suppress duplicate execution after retries",
    "--categories",
    "cs.DC=distributed coordination,cs.DB=durable deduplication",
    "--terms",
    "retry suppression,idempotent execution",
    "--max-full-text-papers",
    "5",
  ]);

  assert.deepEqual(flags?.categories, [
    { id: "cs.DC", why: "distributed coordination" },
    { id: "cs.DB", why: "durable deduplication" },
  ]);
  assert.equal(flags?.maxFullTextPapers, 5);
});

test("search CLI keeps plain category ids backward compatible", () => {
  const flags = parseSearch([
    "Choose a retry mechanism",
    "--categories",
    "cs.DC",
    "--terms",
    "retry semantics",
  ]);

  assert.deepEqual(flags?.categories, [{ id: "cs.DC", why: "caller-selected" }]);
});
