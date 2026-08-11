---
name: neuroarxiv
description: Ground one consequential, still-open technical mechanism or architecture decision in real arXiv prior art, then commit to one actionable build path with traceable limitations. Use when a user explicitly invokes NeuroArxiv or asks to check arXiv/prior art, and implicitly before costly architecture, algorithm, ML/systems, protocol, coordination, retrieval, storage, or optimization choices whose approach remains open. Stay inactive for trivial implementation, glue code, or a user-fixed approach.
---

# NeuroArxiv

Run one evidence-to-decision journey for one Build Problem. Treat the Skill as
the Research Run owner: deterministic retrieval supplies Papers; the caller
Agent supplies judgment. Finish with one Recommended Path or an explicit
failure state.

## 1. Decide Research Eligibility

Proceed immediately when the user explicitly invokes NeuroArxiv, requests an
arXiv check, or asks for prior art.

For implicit use, proceed only when all three conditions hold:

1. The question contains a researchable technical mechanism.
2. A wrong choice would cause consequential implementation effort or rework.
3. The approach remains open rather than fixed by the user.

Otherwise continue the user's task without starting a Research Run.

**Completion criterion:** record one eligible Build Problem, or exit without a
Research Run.

## 2. Frame the Research Run

Write:

- **Build Problem:** one mechanism or architecture decision, not a broad topic.
- **Decision Context:** only constraints that could change the choice. Keep
  repository content and private material out unless load-bearing.
- **Budget:** default to 12 abstract readings, 3 full-text readings, and 1
  mechanism-specific expansion. Apply an explicit caller override as written.

Do not inventory the machine, tools, Skills, CLIs, MCP servers, connectors, or
credentials. Use capabilities the caller has deliberately supplied when the
workflow reaches them.

**Completion criterion:** one bounded Build Problem and the material constraints
needed to judge it.

## 3. Author the Search Plan

Choose 2–5 arXiv categories, 3–6 mechanism-specific terms, and optional broader
mechanism terms for the single permitted expansion. Prefer terms such as
`cache invalidation`, `leader election`, or `change point detection` over product
names and generic words.

Read [references/arxiv-categories.md](references/arxiv-categories.md) when the
category is uncertain or outside familiar computer-science areas. Treat it as
selection guidance, not an allowlist.

**Completion criterion:** every category has a reason, every term names a
mechanism, and the expansion remains relevant to the same Build Problem.

## 4. Collect Research Evidence

Resolve paths relative to this Skill directory and run the bundled helper:

```bash
node scripts/search.mjs "<build problem>" \
  --categories "<cat1>=<reason1>,<cat2>=<reason2>" \
  --terms "<term1>,<term2>" \
  --expand-terms "<broader-term1>,<broader-term2>" \
  --json
```

Omit `--expand-terms` when no honest expansion exists. Add `--since-years 0`
only when older work is relevant; otherwise use the eight-year default. When the
caller explicitly overrides the full-text budget, pass
`--max-full-text-papers <count>` so the emitted Research Evidence records it.

The helper owns sequential requests, courtesy delay, submitted-date constraints,
bounded retry, exact Paper versions, metadata normalization, category merging,
deduplication, and the retained-Paper budget. It uses the public arXiv export
interface without credentials.

If the bundled runtime is unavailable in a source-only checkout, build the
package once and rerun the same helper. If arXiv remains unavailable after its
bounded recovery, return an Incomplete Research Run. Do not install or probe
unrelated capabilities as recovery.

**Completion criterion:** obtain a version-identifiable Paper set and retrieval
coverage, or declare the Research Evidence unavailable.

## 5. Make Isolated Readings

Create one independent reading context per Paper. Each context receives only:

- the Build Problem and minimal Decision Context;
- that Paper's exact id/version, title, authors, date, and abstract;
- the schema below.

Concurrency is an execution choice; isolation is the invariant. A reading that
sees or compares sibling Papers is invalid.

```json
{
  "paperVersion": "exact retrieved version",
  "evidenceDepth": "abstract",
  "approach": "core technical mechanism",
  "borrow": "one concrete implementable takeaway",
  "limitation": "load-bearing weakness or breaking condition",
  "relevanceNote": "fit to the Build Problem"
}
```

For each retained Paper that is irrelevant after isolated reading, record one
`excludedPapers` entry with its exact version and a concrete reason. A retained
Paper must end in exactly one place: a Prior-Art Finding or `excludedPapers`.

Paraphrase. Support only claims present in the material actually read. Re-run one
contaminated reading once in a clean context; persistent contamination makes the
Research Run incomplete.

**Completion criterion:** every retained Paper has one valid abstract-level
Prior-Art Finding or is explicitly excluded as irrelevant.

## 6. Deepen Load-Bearing Evidence

After abstract readings, select at most three Papers capable of changing the
Recommended Path, its risk, or a decisive trade-off. Read each authoritative PDF
in isolation and update its Evidence Depth to `full-text`. Keep claims from other
Papers bounded to their abstracts.

Full-text failure does not erase valid abstract evidence. It limits the claim and
becomes an Open Thread when the missing detail is consequential.

**Completion criterion:** load-bearing claims have the deepest evidence available
within budget, and every claim remains bounded by declared Evidence Depth.

## 7. Converge

Score each Prior-Art Finding for relevance, practicality, and reported rigor.
Group findings into Architectural Angles by underlying mechanism, not keywords.
Stop when new relevant Papers repeat the represented mechanisms, limitations,
and trade-offs without changing the decision: this is Evidence Saturation.

Choose exactly one Recommended Path. Synthesize:

- an actionable mechanism sketch;
- the first concrete implementation step;
- the load-bearing risk;
- citations with exact Paper versions and evidence roles;
- Prior-Art Pitfalls drawn from stated limitations;
- one-line trade-offs for Alternate Paths;
- consequential Open Threads.

Give every Evidence Citation an explicit source. A Research Evidence citation
uses `source: "paper"` plus the exact `paperVersion`. A Documentation Evidence
citation uses `source: "documentation"` plus the exact `sourceIdentity` declared
in Documentation Evidence coverage. Keep Prior-Art Pitfalls Paper-backed.

If the path depends on the current interface or constraints of a concrete
dependency, consult version-specific Documentation Evidence using the caller's
normal documentation capability. Documentation describes current intended use;
Papers describe mechanisms and reported evidence. The caller Agent owns the
judgment connecting them.

**Completion criterion:** one path wins for stated reasons and every load-bearing
claim resolves to the Evidence Chain that supports it.

## 8. Validate and Report

Assemble the structured artifact defined in
[references/research-run-artifact.md](references/research-run-artifact.md), write
it to an operating-system temporary JSON file, and run:

```bash
node scripts/validate.mjs <temporary-research-run.json>
```

Remove the temporary file after validation. For Complete or Thin Coverage, fix
every reported structural error within the existing budget before reporting. For
an Incomplete Research Run, preserve the validator errors as the explicit failure
reason; never erase broken isolation or an Evidence Chain to make validation pass.

Reject unknown Paper ids, synthesized titles or URLs, sibling-aware readings,
claims deeper than their Evidence Depth, and citations whose role is unsupported.

Use exactly one outcome:

- **Complete:** one Recommended Path has intact load-bearing Evidence Chains.
- **Thin Coverage:** sparse Research Evidence supports only a bounded path.
- **Incomplete Research Run:** bounded recovery cannot repair retrieval,
  isolation, validation, or a load-bearing Evidence Chain.

Report in this order:

1. **Research Run status**
2. **Build Problem and Decision Context**
3. **Searched** — categories, terms, expansion, Paper count
4. **Evidence Coverage** — Research Evidence and conditional Documentation Evidence
5. **Papers read** — exact version, Evidence Depth, approach, limitation
6. **Architectural Angles**
7. **THE PATH** — recommendation, first step, risk, Evidence Chains
8. **Alternate Paths**
9. **Prior-Art Pitfalls**
10. **Open Threads**

Documentation Evidence coverage is `used`, `not needed`, or `unavailable`, with a
reason and version/source identity when used. Do not add another evidence role.

**Completion criterion:** the user can start implementation from one path while
seeing exactly what the research supports, what it does not, and why the run
stopped.
