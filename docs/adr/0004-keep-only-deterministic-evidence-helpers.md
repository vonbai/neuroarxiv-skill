# Keep only deterministic evidence helpers

The repository will remove embedded LLM and Claude Agent SDK execution while retaining deterministic helpers for arXiv retrieval, evidence parsing, normalization, validation, Skill installation, and a supporting CLI. The caller Agent owns Research Eligibility, interpretation, scoring, Architectural Angles, and the Recommended Path; the helper code does not expose callbacks for injecting those judgments.
