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

Install one user-level copy for Codex and link that copy into Claude Code:

```bash
npx skills@1.5.22 add vonbai/neuroarxiv-skill \
  --skill neuroarxiv \
  --global \
  --agent codex \
  --agent claude-code \
  --yes
```

The standard installer creates this layout:

```text
~/.agents/skills/neuroarxiv             canonical Skill
~/.claude/skills/neuroarxiv             symlink to the canonical Skill
```

Codex reads `~/.agents/skills` directly. The bundle contains `SKILL.md`, both
references, Agent metadata, search and validation wrappers, and the generated
dependency-free runtime. The installer requires Node 22.20 or newer; the
installed NeuroArxiv runtime supports Node 18 or newer.

Update or remove the Skill through the same owner:

```bash
npx skills@1.5.22 update neuroarxiv --global --yes
npx skills@1.5.22 remove neuroarxiv --global --yes
```

Do not pass an Agent filter when removing the complete Skill: the manager must
remove every Agent link before deleting the canonical copy and lock entry.

## Use

Invoke the Skill with one open Build Problem. Use `$neuroarxiv` in Codex or
`/neuroarxiv` in Claude Code:

```text
$neuroarxiv How should we invalidate shared LLM response caches without
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

Research Evidence coverage is `ready`, `thin`, `empty`, or `unavailable`; the
last two distinguish a successful zero-match Search Plan from a failed source.
The Research Run ends as `Complete`, `Thin Coverage`, or
`Incomplete Research Run`. It never pads a weak result set or invents a
citation to force a recommendation, and every incomplete outcome names one
explicit reason and re-entry condition.

## Deterministic adapter

Agents or scripts can collect the same normalized Research Evidence without
semantic inference:

```bash
evidence_dir="$(mktemp -d)"
evidence_file="$evidence_dir/research-evidence.json"
npx github:vonbai/neuroarxiv-skill search \
  "cache invalidation across concurrent writers" \
  --categories "cs.DB=durable deduplication,cs.DC=distributed coordination" \
  --terms "cache invalidation,cache coherence" \
  --expand-terms "distributed cache consistency" \
  --output "$evidence_file"
```

The caller supplies the Search Plan. The adapter does not select categories,
score Papers, cluster Architectural Angles, or choose a path. `--output` is its
only result interface: the adapter claims that fresh path before retrieval,
reports liveness on stderr, and atomically publishes one complete JSON Evidence
Artifact. Resume the same process when an execution tool yields and read the file
only after exit status 0.

Inside that narrow interface, the Research Run validates complete Paper identity,
serializes every request, retains the complete retry chain, reconciles selected
Paper versions even after the retention cap, enforces one wall-clock deadline,
and stops the source after one Search Attempt exhausts recovery. Expansion is
used only for semantic recall after the entire initial phase succeeds with thin
coverage.

## Architecture

```text
Build Problem + Decision Context
              │
              ▼
Caller Agent authors Search Plan
              │
              ▼
Research Run module
  serialize → query → trace → retry → stop/expand → normalize → bound
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
  three-way Paper disposition, Retrieval Termination, explicit incomplete outcomes, and
  typed Evidence Chains without making semantic judgments.

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
the generated runtime projection, Skill structure, a snapshot-bound Agent
journey forward evaluation, and an isolated standard global
install/update/symlink/helper/uninstall lifecycle. The forward-evaluation receipt
is bound to the exact `SKILL.md` SHA-256, so a Skill change requires fresh
explicit-entry, trivial non-entry, and persistent-contamination observations.
Nodes older than 22.20 still verify the self-contained Skill bundle but skip the
external installer lifecycle.

## Evaluation provenance

[`EVALS.md`](./EVALS.md) and
[`bench/deep-tech-eval-transcripts.md`](./bench/deep-tech-eval-transcripts.md)
are retained as historical upstream evaluation evidence. They measured the
former v0.1 workflow and are not presented as validation of the current
Skill-first implementation.

## License

MIT
