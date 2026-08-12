# Research Run artifact contract

Use this structure only when Step 8 validates the completed Research Run. Load
the `researchEvidence` object verbatim from the atomically published Evidence
Artifact created in Step 4; do not reconstruct Paper metadata or substitute
captured stdout.

```json
{
  "status": "complete | thin | incomplete",
  "incompleteReason": null,
  "problem": "same Build Problem as researchEvidence.problem",
  "researchEvidence": {},
  "findings": [
    {
      "paperVersion": "2601.00001v2",
      "evidenceDepth": "abstract | full-text",
      "isolationStatus": "isolated | recovered",
      "approach": "mechanism",
      "borrow": "concrete implementation takeaway",
      "limitation": "reported breaking condition",
      "relevanceNote": "fit to the Build Problem"
    }
  ],
  "excludedPapers": [
    {
      "paperVersion": "2601.00002v1",
      "reason": "specific reason this retained Paper is irrelevant"
    }
  ],
  "readingFailures": [],
  "angles": [
    {
      "label": "underlying mechanism",
      "paperVersions": ["2601.00001v2"]
    }
  ],
  "recommendedPath": {
    "angle": "one label from angles",
    "sketch": "actionable mechanism",
    "firstStep": "first implementation step",
    "loadBearingRisk": "decisive risk",
    "citations": [
      {
        "source": "paper",
        "paperVersion": "2601.00001v2",
        "role": "primary mechanism"
      },
      {
        "source": "documentation",
        "sourceIdentity": "Dependency 4.2 official documentation",
        "role": "current dependency interface"
      }
    ]
  },
  "alternates": [
    {
      "angle": "another label from angles",
      "tradeOff": "why it lost"
    }
  ],
  "pitfalls": [
    {
      "paperVersion": "2601.00001v2",
      "risk": "failure condition grounded in the Paper limitation"
    }
  ],
  "openThreads": ["consequential unanswered question"],
  "documentationEvidence": {
    "status": "used | not-needed | unavailable",
    "reason": "why this coverage status applies",
    "sourceIdentity": "required only when status is used"
  }
}
```

Use `incompleteReason: null` for Complete or Thin Coverage. For `incomplete`, use
`recommendedPath: null` and exactly one object:

```json
{
  "kind": "research-evidence-empty | research-evidence-unavailable | isolation-broken | evidence-chain-broken | validation-failed",
  "detail": "the concrete condition that stopped this Research Run",
  "reentryCondition": "the concrete change that would justify a new Research Run"
}
```

For `isolation-broken`, account for each affected Paper without fabricating a
successful Finding or Exclusion:

```json
{
  "paperVersion": "2601.00003v1",
  "kind": "isolation-broken",
  "detail": "sibling Paper context persisted after one clean re-read"
}
```

Complete requires ready retrieval coverage and at least three usable findings.
Thin Coverage requires available retrieval coverage and one or two usable
findings; this remains true when a larger retrieved set contains reasoned
exclusions. Every retained Paper must appear exactly once in `findings`,
`excludedPapers`, or `readingFailures`. A Reading Failure is valid only for an
Incomplete `isolation-broken` outcome. Documentation citations must match the declared
`sourceIdentity` exactly.
