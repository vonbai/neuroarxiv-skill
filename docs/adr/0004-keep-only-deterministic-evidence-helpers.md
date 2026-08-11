# Keep only deterministic evidence helpers

The repository removes embedded LLM and Claude Agent SDK execution while retaining deterministic helpers for arXiv retrieval, evidence parsing, normalization, validation, and a supporting CLI. The Skill bundle carries a generated, dependency-free runtime projection; the standard Skills CLI owns installation, updates, Agent symlinks, and removal. The caller Agent owns Research Eligibility, interpretation, scoring, Architectural Angles, and the Recommended Path; helper code does not expose callbacks for injecting those judgments.
