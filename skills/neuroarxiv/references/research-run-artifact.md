# Research Run artifact contract

Use this structure only when Step 8 validates the completed Research Run. Reuse
the `researchEvidence` object emitted by `scripts/search.mjs`; do not reconstruct
Paper metadata.

```json
{
  "status": "complete | thin | incomplete",
  "problem": "same Build Problem as researchEvidence.problem",
  "researchEvidence": {},
  "findings": [
    {
      "paperVersion": "2601.00001v2",
      "evidenceDepth": "abstract | full-text",
      "isolationStatus": "isolated | recovered | broken",
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

Use `recommendedPath: null` for `incomplete`. Complete requires ready retrieval
coverage and at least three usable findings. Thin Coverage requires available
retrieval coverage and one or two usable findings; this remains true when a
larger retrieved set contains reasoned exclusions. Every retained Paper must
appear exactly once in `findings` or `excludedPapers`. Documentation citations
must match the declared `sourceIdentity` exactly.
