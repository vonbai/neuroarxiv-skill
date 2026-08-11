# Prior-Art-Grounded Architecture Decisions

NeuroArxiv turns one consequential, open technical design question into one actionable path grounded in retrieved research, while preserving the limits and failure conditions of that research.

## Language

**Build Problem**:
An open technical mechanism or architecture decision whose wrong answer would cause meaningful implementation rework.
_Avoid_: Query, prompt, coding task

**Research Eligibility**:
The determination that a Build Problem is consequential, technically researchable, and still open enough to justify a Research Run.
_Avoid_: Auto-trigger, pre-flight gate

**Research Run**:
One complete evidence-to-decision journey for a single Build Problem and its supplied constraints.
_Avoid_: Search session, survey, chat

**Decision Context**:
A bounded, purpose-specific account of the codebase constraints that materially affect a Build Problem.
_Avoid_: Context file, repository dump, prompt context

**Search Plan**:
The subject areas and mechanism-specific terms used to discover prior art for a Build Problem.
_Avoid_: Query string, keywords

**Paper**:
A version-identifiable research work whose descriptive metadata was retrieved from an authoritative catalogue.
_Avoid_: Source, document, search result

**Isolated Reading**:
An interpretation of exactly one Paper against the Build Problem, made without visibility into other Papers in the Research Run.
_Avoid_: Summary, branch

**Prior-Art Finding**:
The approach, concrete borrow, limitation, and relevance extracted by an Isolated Reading.
_Avoid_: Paper read, note

**Paper Exclusion**:
The exact version and reason for a retained Paper found irrelevant after Isolated Reading.
_Avoid_: Missing finding, silent drop

**Research Evidence**:
Evidence grounded in a Paper that supports claims about a mechanism, its evaluation, and its reported limitations.
_Avoid_: Documentation Evidence, implementation example

**Documentation Evidence**:
Version-specific documentation or examples for a known dependency that support claims about its current, intended use.
_Avoid_: Prior art, mechanism validation, implementation proof

**Architectural Angle**:
A distinct underlying mechanism shared by one or more Prior-Art Findings.
_Avoid_: Cluster, topic, category

**Recommended Path**:
The single Architectural Angle selected for implementation, together with its synthesis, first step, load-bearing risk, and evidence.
_Avoid_: Best paper, shortlist, option

**Alternate Path**:
An Architectural Angle considered but not selected, retained with the trade-off that caused it to lose.
_Avoid_: Rejected idea, runner-up paper

**Prior-Art Pitfall**:
A concrete failure condition grounded in a Paper's stated limitation that should not be rediscovered during implementation.
_Avoid_: Generic risk, model warning

**Evidence Chain**:
The trace from a recommendation, trade-off, or Prior-Art Pitfall back to the source-specific Research Evidence or Documentation Evidence that supports it.
_Avoid_: Citation list, generated rationale

**Evidence Depth**:
The deepest retrieved material actually examined for a Paper, which limits the claims that its Evidence Chain can support.
_Avoid_: Confidence score, paper quality

**Evidence Saturation**:
The point at which additional relevant Papers repeat the mechanisms, limitations, and trade-offs already represented in the Research Run without materially changing its decision.
_Avoid_: Search exhaustion, paper quota, consensus

**Evidence Coverage**:
The declared status and reason for each evidence role in a Research Run, including evidence used, Thin Coverage, inapplicability, or unavailability.
_Avoid_: Capability Manifest, tool inventory, source count

**Thin Coverage**:
A valid outcome in which the Search Plan yields too few relevant Papers to support a Recommended Path without padding.
_Avoid_: Retrieval failure, empty result

**Incomplete Research Run**:
A Research Run that cannot produce a valid Recommended Path because isolation, validation, or its Evidence Chain remains broken after bounded recovery.
_Avoid_: Thin Coverage, partial success

**Open Thread**:
A consequential question that the retrieved Papers do not answer and that must remain visible for later design review.
_Avoid_: TODO, caveat
