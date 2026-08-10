<p align="center">
  <img src="Assets/banner.png" alt="NeuroArxiv — Never Build From Scratch" width="100%">
</p>

# NeuroArxiv Skill

[![CI](https://github.com/vonbai/neuroarxiv-skill/actions/workflows/ci.yml/badge.svg)](https://github.com/vonbai/neuroarxiv-skill/actions/workflows/ci.yml)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](#install)

> Before an Agent commits to a consequential technical mechanism, ground the
> choice in real arXiv prior art and finish with one actionable path.

NeuroArxiv is a Skill-first Research Run. It retrieves version-identifiable
Papers, keeps readings isolated, deepens only load-bearing evidence, and
converges on one Recommended Path with its first step, risk, citations,
Prior-Art Pitfalls, and Open Threads.

It is not another Agent runtime. The caller Agent owns category and term
selection, reading, synthesis, and judgment. The bundled deterministic module
owns arXiv request discipline, metadata, deduplication, budgets, and Evidence
Chain validation. There is no embedded LLM, Claude Agent SDK, provider
credential, or arXiv API key.

Original project by [Udit Akhouri](https://github.com/UditAkhourii). This
maintained fork preserves the original outcome while making the Skill the
single product journey.

## Install

Install the complete Skill bundle for Claude Code:

```bash
npx github:vonbai/neuroarxiv-skill install
```

Or choose another explicit Skill directory:

```bash
npx github:vonbai/neuroarxiv-skill install \
  --destination ~/.codex/skills/neuroarxiv
```

The installer copies `SKILL.md`, its category reference, Agent metadata, the
search wrapper, and the minimal deterministic runtime. Start a new Agent
session after installation.

## Use

Invoke the Skill with one open Build Problem:

```text
/neuroarxiv How should we invalidate shared LLM response caches without
serving stale policy-sensitive results?
```

Explicit invocation always runs. Implicit invocation requires all three:

1. a researchable technical mechanism;
2. consequential implementation or rework;
3. an approach the user has not already fixed.

The default budget is:

- at most 12 abstract-level Paper readings;
- at most 3 load-bearing full-text readings;
- at most 1 caller-authored mechanism expansion.

The Research Run ends as `Complete`, `Thin Coverage`, or
`Incomplete Research Run`. It never pads a weak result set or invents a
citation to force a recommendation.

## Deterministic adapter

Agents or scripts can collect the same normalized Research Evidence without
semantic inference:

```bash
npx github:vonbai/neuroarxiv-skill search \
  "cache invalidation across concurrent writers" \
  --categories cs.DB,cs.DC \
  --terms "cache invalidation,cache coherence" \
  --expand-terms "distributed cache consistency" \
  --json
```

The caller must supply the Search Plan. The adapter does not select categories,
score Papers, cluster Architectural Angles, or choose a path.

## Architecture

```text
Build Problem + Decision Context
              │
              ▼
Caller Agent authors Search Plan
              │
              ▼
Research Run module
  serialize → query → retry → parse → normalize → deduplicate → bound
              │
              ▼
Versioned Research Evidence
              │
              ▼
Isolated readings → selective full text → Architectural Angles
              │
              ▼
ONE Recommended Path + Evidence Coverage + Open Threads
```

The public package interface is intentionally narrow:

- `collectResearchEvidence` collects deterministic arXiv evidence.
- `validateResearchRun` checks budgets, isolation declarations, Paper identity,
  and Evidence Chains without making semantic judgments.

The domain glossary and architecture decisions live in
[`CONTEXT.md`](./CONTEXT.md) and [`docs/adr`](./docs/adr). The accepted upgrade
spec is [`docs/specs/0001-skill-first-research-run.md`](./docs/specs/0001-skill-first-research-run.md).

## Development

```bash
npm install
npm run check
npm pack --dry-run
```

`npm run check` covers types, fixture-driven Research Run behavior, clean build,
Skill structure, and an isolated installation smoke test.

## Evaluation provenance

[`EVALS.md`](./EVALS.md) and
[`bench/deep-tech-eval-transcripts.md`](./bench/deep-tech-eval-transcripts.md)
are retained as historical upstream evaluation evidence. They measured the
former v0.1 workflow and are not presented as a validation of this revised v0.2
implementation.

## License

MIT
