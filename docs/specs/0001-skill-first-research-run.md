# Skill-first prior-art Research Run

## Problem Statement

An Agent facing a consequential, still-open technical mechanism can start building before it understands relevant academic prior art. The current NeuroArxiv repository addresses that problem twice: the Skill defines one Agent-led journey, while the companion implementation embeds a Claude-specific reasoning loop with different search, widening, category, and failure rules. This creates two owners, requires credentials that arXiv retrieval does not need, and lets deterministic retrieval details drift away from the canonical user journey.

The user needs NeuroArxiv to remain focused on its original outcome: turn one Build Problem into one actionable Recommended Path grounded in real Papers, with the limits of that Research Evidence kept visible. The Skill must work through the caller Agent's own reasoning and available tools. It must not become a repository assessor, a general evidence aggregator, or another Agent runtime.

## Solution

Make the Skill the canonical adapter for one Research Run. The caller Agent owns Research Eligibility, Search Plan semantics, Isolated Reading, Architectural Angles, and selection of the Recommended Path. A deterministic deep module owns arXiv request discipline, bounded retrieval, Paper identity, metadata parsing, normalization, deduplication, and validation of Research Evidence. A supporting CLI exposes that same deterministic interface without recreating semantic judgment.

Each Research Run starts from one Build Problem and bounded Decision Context. Explicit invocation always runs. Implicit invocation runs only when a technical mechanism is open, the choice is consequential, and the user has not already fixed the approach. The default budget retains at most twelve relevant Papers for abstract-level reading, deepens at most three load-bearing Papers to full text, and permits one mechanism-specific search expansion. The run stops at Evidence Saturation or the budget limit and ends as a complete recommendation, Thin Coverage, or an Incomplete Research Run.

Research Evidence from arXiv is the product's core evidence. One fresh Retrieval Owner serializes the entire Search Plan, preserves every low-level request outcome, and stops the source after one Search Attempt exhausts its retry budget. Semantic expansion runs only after every initial Search Attempt succeeds but coverage remains thin. One wall-clock deadline bounds courtesy waits, server-directed waits, requests, and response bodies. Documentation Evidence may clarify the current interface or constraints of a concrete dependency already relevant to the path. Repository discovery, repository-quality assessment, and runtime discovery of external capabilities remain outside the product.

## User Stories

1. As an Agent facing an open Build Problem, I want to check relevant academic prior art before implementation, so that I do not rediscover known mechanisms and failure modes.
2. As a user explicitly invoking NeuroArxiv, I want the Research Run to start without an additional eligibility gate, so that my direct intent is honored.
3. As an Agent considering implicit invocation, I want a precise Research Eligibility rule, so that trivial or already-converged work does not incur research cost.
4. As a builder, I want one Research Run to address one Build Problem, so that evidence and recommendations do not mix unrelated decisions.
5. As a builder, I want Decision Context to contain only constraints material to the decision, so that proprietary or irrelevant repository content is not unnecessarily disclosed.
6. As an Agent, I want to design mechanism-specific categories and search terms, so that retrieval follows the actual technical question rather than generic product language.
7. As an Agent researching a domain outside computer science, I want valid arXiv categories to remain usable without a narrow curated allowlist, so that physics, mathematics, biology, statistics, and engineering questions do not fail silently.
8. As a caller, I want arXiv requests serialized and courtesy-rate-limited, so that the Research Run respects the catalogue's operating constraints.
9. As a caller, I want date limits represented in the arXiv query when possible, so that irrelevant metadata is not fetched and discarded locally.
10. As a caller, I want Paper metadata normalized and duplicate versions reconciled deterministically, so that one work cannot distort the evidence set by appearing multiple times.
11. As a caller, I want every Paper to retain its exact retrieved version and authoritative abstract and PDF links, so that later claims can be traced to the material actually examined.
12. As an Agent, I want each abstract-level Isolated Reading to see exactly one Paper and the Build Problem, so that another Paper cannot anchor its interpretation.
13. As an Agent, I want to promote only load-bearing Papers to full-text reading, so that deeper evidence is spent where it can change the decision.
14. As a builder, I want each Prior-Art Finding to identify the mechanism, concrete borrow, limitation, and relevance, so that research translates into implementation choices.
15. As a builder, I want findings grouped by Architectural Angle rather than surface keywords, so that competing mechanisms can be compared coherently.
16. As a builder, I want one Recommended Path rather than an unranked shortlist, so that the Research Run ends in an actionable decision.
17. As a builder, I want Alternate Paths to retain the trade-off that caused them to lose, so that the decision can be revisited when constraints change.
18. As a builder, I want Prior-Art Pitfalls grounded in stated Paper limitations, so that warnings are not generic model speculation.
19. As a reviewer, I want every load-bearing recommendation and warning to trace through an Evidence Chain to a retrieved Paper, so that invented or mismatched citations are rejected.
20. As a reviewer, I want Evidence Depth declared per Paper, so that abstract-only claims are not presented as full-text findings.
21. As a reviewer, I want Research Evidence Coverage to distinguish ready, thin, empty, and unavailable results, so that missing evidence is visible without probing the caller's machine.
22. As a builder with sparse but usable research, I want the result marked Thin Coverage, so that the limited recommendation remains useful without being overstated.
23. As a builder whose load-bearing evidence cannot be validated, I want an Incomplete Research Run instead of a fabricated recommendation, so that failure remains honest and actionable.
24. As an Agent, I want unanswered consequential questions preserved as Open Threads, so that uncertainty survives convergence.
25. As an Agent with richer or poorer tool access, I want NeuroArxiv to use capabilities I deliberately provide without inventorying my environment, so that the Skill stays portable and lightweight.
26. As a user of a current dependency, I want the caller Agent to consult version-specific Documentation Evidence when it matters, so that a sound Paper mechanism is not confused with an obsolete library interface.
27. As a user without an arXiv credential, I want deterministic retrieval to work without authentication, so that nonexistent credential optimizations do not block research.
28. As a maintainer, I want the Skill and supporting CLI to share one deterministic retrieval implementation, so that request, parsing, budget, and identity rules cannot drift.
29. As a maintainer, I want semantic judgment to remain outside the deterministic module, so that no hidden LLM, model selection, or provider credential becomes a second owner.
30. As a maintainer, I want the installed Skill bundle to include every required reference, so that installation cannot silently omit part of the workflow.
31. As a reviewer, I want every retained Paper to have one Finding, Exclusion, or Reading Failure, so that unread or unreadable evidence cannot disappear from the Research Run.
32. As a user of multiple coding Agents, I want one canonical Skill copy with Agent-specific links and one removal command, so that installs cannot drift or leave unowned files behind.
33. As an Agent using an execution tool that yields before a long command exits, I want to resume the same Retrieval Owner, so that an empty initial output chunk cannot trigger duplicate arXiv requests.
34. As a caller consuming structured Research Evidence, I want one atomically published Evidence Artifact, so that partial stdout, concurrent retries, and overwritten results cannot become competing sources of truth.
35. As a caller facing throttling or timeout, I want the first exhausted Search Attempt to stop the source, so that categories and expansion cannot amplify one upstream failure.
36. As a reviewer, I want every failed HTTP request preserved as a structured Retrieval Failure, so that the first cause cannot be replaced by the last exception.
37. As a builder, I want successful zero-match retrieval distinguished from source unavailability, so that I know whether to revise the Search Plan or restore access.
38. As a caller, I want bounded recovery to include a wall-clock deadline, so that a large `Retry-After` value cannot make a Research Run wait indefinitely.
39. As a reviewer, I want every Incomplete Research Run to name one Incomplete Reason, so that an honest failure is also actionable.
40. As a reviewer, I want malformed Atom entries rejected before they become Papers, so that empty or untrusted metadata cannot enter an Evidence Chain.
41. As a reviewer, I want every retained Paper to end as exactly one Finding, Exclusion, or Reading Failure, so that persistent isolation failure remains honest and accounted for.
42. As a builder receiving an incomplete result, I want its re-entry condition stored with its reason, so that I know when a new Research Run would be worthwhile.
43. As a caller overriding Paper budgets, I want every explicit override passed through the one Research Run seam, so that the recorded budget matches my intent.
44. As a maintainer, I want conformance gates for entry, evidence routing, reading disposition, terminal reporting, and re-entry, so that the complete Skill journey cannot silently erode.

## Implementation Decisions

- The canonical user journey is Skill-first. The Skill is the owner of Research Run sequencing and semantic instructions; the CLI is a supporting adapter.
- Research Run is the single domain owner and the highest public seam. Low-level arXiv parsing, query construction, taxonomy helpers, and rate limiting remain implementation details behind that interface.
- The deterministic module accepts a caller-authored Search Plan. It does not infer categories, search terms, scores, clusters, or recommendations.
- The public deterministic interface returns normalized Research Evidence and explicit retrieval coverage. It does not expose low-level helpers that allow callers to bypass Research Run invariants.
- The implementation removes the Claude Agent SDK, every internal LLM call, provider/model flags, LLM concurrency controls, prompt parsing, and SDK-specific adapters.
- The module uses the unauthenticated arXiv export interface. No API-key or credential workflow is introduced.
- arXiv requests are serialized with at least the required courtesy interval. Retry behavior is bounded by attempt count and one Research Run deadline, honors server throttling only within that deadline, and creates a fresh timeout for each attempt and its response body.
- Date filtering is pushed into the arXiv Search Plan query when supported. Local filtering remains a defensive validation rather than the primary efficiency mechanism.
- Retrieval is bounded by the Research Run budget. The default result set contains at most twelve deduplicated Papers and performs at most one mechanism-specific expansion after a fully successful initial phase.
- Paper identity is version-aware. Deduplication uses the canonical bare arXiv identity while preserving the exact retrieved version and merging surfaced categories.
- Atom entries missing versioned identity, title, abstract, author, or timestamps are invalid responses rather than Papers. Canonical abstract and PDF links derive only from the verified versioned identity. A malformed entry stops the source through the same structured Retrieval Failure path as other unusable responses.
- The retained-Paper cap limits new bare identities, not reconciliation. The module continues scanning already retrieved batches after the cap so a selected Paper still receives its newest retrieved version and every surfaced category.
- Category validation accepts valid arXiv taxonomy shapes and does not restrict the caller to the old curated subset. A bundled reference may aid category selection without becoming a programmatic allowlist.
- The caller Agent performs all Isolated Readings. Each reading sees one Paper, the Build Problem, and only the minimal Decision Context needed for that reading.
- Abstract reading is the default Evidence Depth. At most three load-bearing Papers are selected for full-text reading under the default budget.
- Research Evidence owns claims about mechanisms, reported evaluation, applicable conditions, and stated limitations. Documentation Evidence owns claims about the current intended interface and constraints of a concrete dependency. The caller Agent owns the judgment connecting both to the Build Problem.
- A missing dependency interface does not invalidate a Paper mechanism; it may imply custom implementation. An unresolved load-bearing conflict becomes an Open Thread or makes the Research Run incomplete.
- Research Evidence citations resolve to exact Paper versions in the Research Run. Documentation Evidence citations resolve to the declared version/source identity. Unknown identifiers are validation failures and never receive synthesized URLs or titles.
- A successful Isolated Reading produces either a Prior-Art Finding or a reasoned Paper Exclusion. Persistent contamination produces a Reading Failure instead; it is the Paper's sole disposition and requires an Incomplete `isolation-broken` outcome.
- Evidence Saturation ends reading when additional relevant Papers repeat existing mechanisms, limitations, and trade-offs without changing the decision. Deterministic retrieval stops initial collection when it has ready coverage and does not claim semantic saturation.
- Evidence Coverage is `ready`, `thin`, `empty`, or `unavailable`. `empty` means the applicable Search Plan completed successfully with no Paper; `unavailable` means retrieval failed before usable evidence was obtained.
- Thin Coverage is a valid outcome when one or two usable findings still support a bounded recommendation, including when a larger retrieved set contains reasoned exclusions. Every Incomplete Research Run records one Incomplete Reason; it is required when Research Evidence is empty or unavailable, isolation is broken, validation fails, or a load-bearing Evidence Chain remains broken.
- Every Incomplete Reason includes one concrete re-entry condition. It names the external change, recovered isolation, repaired evidence chain, or materially narrower future decision that would justify another Research Run.
- The Skill declares static evidence obligations and final Evidence Coverage. It does not create a Capability Manifest or probe Skills, CLIs, MCP servers, connectors, credentials, or machine capacity.
- Documentation lookup is conditional on a concrete dependency question. Context7 or similar caller-owned capabilities may satisfy that role, but no particular tool is required or hardcoded.
- GitHub repository discovery, maturity scoring, admission, and execution are outside the product scope.
- The package repository identity becomes NeuroArxiv Skill at its renamed fork location while retaining clear upstream attribution and MIT licensing.
- The standard Skills CLI owns install, update, Agent symlinks, lock state, and removal. The repository ships one self-contained Skill bundle and no second installer.
- The committed Skill runtime is a generated projection of the TypeScript source. CI rejects a stale projection so it cannot become a second implementation owner.
- Historical evaluations remain historical evidence. Current product documentation must distinguish claims measured against the former implementation from guarantees of the revised implementation.
- For the Skill journey, one helper process is the Retrieval Owner for one fresh Evidence Artifact path. The required `--output` interface is the only result path; a short-lived adjacent ownership marker rejects a second process before it can contact arXiv.
- The Retrieval Owner reports liveness through stderr and atomically publishes the complete JSON file after collection. The Evidence Artifact, rather than captured stdout or the ownership marker, is the single source of truth for subsequent readings and validation.
- A yielded execution handle means the Retrieval Owner is still active. The caller resumes that exact handle until an exit status is available and only performs bounded recovery after the original process is confirmed stopped.
- A failed Search Attempt cannot contain a successful request. Non-deadline terminal failures must match the final failed request exactly; a deadline may terminate before any HTTP request or after an earlier failed request while waiting for bounded recovery.

## Testing Decisions

- Test external Research Run behavior at the highest seam. Prefer one deterministic fixture-driven seam over parallel tests of every internal helper.
- Given a caller-authored Search Plan and recorded arXiv feeds, the Research Run test must observe query bounds, sequential request behavior, metadata normalization, version-aware deduplication, category merging, and the final evidence budget.
- Given thin initial coverage, the Research Run test must observe at most one mechanism-specific expansion and a truthful Thin Coverage result when sparse evidence remains usable.
- Given no retrievable evidence or exhausted bounded recovery, the Research Run test must observe an incomplete result rather than fabricated Papers or a Recommended Path.
- Given malformed Atom entries, throttling, timeout, retry exhaustion, or an excessive `Retry-After`, tests must observe a structured request chain, deadline-bounded recovery, source-wide termination after the first exhausted Search Attempt, and no semantic expansion of an outage.
- Given a retained-Paper cap reached before a duplicate appears in another category, tests must still observe the newest retrieved version and merged categories for that selected Paper.
- Given successful requests with zero results, tests must observe `empty`; given failed retrieval with zero results, tests must observe `unavailable`.
- Given citations that reference unknown Paper identities, validation must reject the Evidence Chain without inventing metadata.
- Given more than twelve abstract readings or more than three full-text readings under the default budget, validation must reject the run unless an explicit caller budget override is recorded.
- Given two readings that share sibling Paper content, the Skill's conformance evaluation must treat isolation as broken and require a bounded re-read or an incomplete result.
- Given persistent contamination after bounded clean recovery, validation must accept one Reading Failure as the Paper's sole disposition only when the result is Incomplete with `isolation-broken` and an actionable re-entry condition.
- Given a delayed collection, the CLI test must observe an ownership marker and no final Evidence Artifact before completion, then exactly one complete JSON artifact after completion. Invocation without a fresh `--output` path must fail before retrieval.
- Given a second command using an active or completed Evidence Artifact path, the CLI test must reject it before another collection starts or existing evidence is overwritten.
- Given a complete Research Run, conformance evaluation must observe exactly one Recommended Path, visible Alternate Paths where applicable, Prior-Art Pitfalls, Evidence Depth, Evidence Coverage, and Open Threads. Given an incomplete run, validation must observe one Incomplete Reason and no Recommended Path.
- Given an explicit invocation, conformance evaluation must observe that the run starts. Given an implicit trivial or already-converged task, it must observe that the Skill stays out of the way.
- The Skill contract gate must check each ordered journey step independently: explicit and implicit entry, caller budget propagation, evidence routing, three-way Paper disposition, complete/thin reporting, and incomplete reason plus re-entry.
- A fresh isolated Agent forward evaluation must exercise explicit entry, trivial implicit non-entry, and persistent sibling-reading contamination. Its receipt is evidence rather than behavior authority and is bound to the exact `SKILL.md` SHA-256, so any Skill change requires a new evaluation.
- The package contract test must verify that no Claude SDK, internal LLM runtime, provider credential, or model flag remains in production dependencies or public usage.
- The installation test must verify that the complete Skill bundle, including referenced material, reaches the selected destination.
- On a compatible Node version, the installation test must exercise the standard global install, update, canonical Skill, Claude Code symlink, helper execution, lock cleanup, and removal while preserving an unrelated Skill.
- Keep parser-level tests only for regressions that cannot be made observable through the Research Run seam, such as XML entity decoding.
- A live arXiv smoke check may verify integration separately, but repeatable acceptance relies on recorded fixtures rather than network availability or changing search results.

## Out of Scope

- Discovering, ranking, admitting, or executing GitHub repositories.
- General web research or evidence aggregation beyond arXiv Research Evidence and conditional dependency documentation.
- Embedding Claude Agent SDK, another Agent runtime, an internal LLM, or a provider-routing layer.
- Detecting or inventorying local Skills, CLIs, MCP servers, connectors, credentials, or machine resources.
- Managing Context7, GitHub, Anthropic, OpenAI, or arXiv credentials.
- Automatically deciding the semantic Search Plan, Isolated Readings, scores, Architectural Angles, or Recommended Path.
- Treating full-text retrieval as mandatory for every Paper.
- Padding a thin result set to satisfy a numerical target.
- Reproducing third-party implementations or benchmarking external repositories.
- Changing the original outcome of committing to one actionable, prior-art-grounded path.

## Further Notes

- The maintained fork is named `neuroarxiv-skill` and remains linked to its upstream repository.
- The accepted default budget is twelve abstract-level Papers, three full-text Papers, and one search expansion. The caller may explicitly override it without triggering environment discovery.
- arXiv credentials do not improve the public export interface used by this product. Efficiency comes from bounded mechanism-specific queries, server-side date constraints, normalization, deduplication, caching where appropriate, and respectful serialization.
- The domain glossary and accepted ADRs are normative for implementation vocabulary and ownership.
