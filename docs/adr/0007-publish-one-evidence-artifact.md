# Publish one owned Evidence Artifact

Each Research Run assigns one Retrieval Owner to one fresh Evidence Artifact path. The required `--output` interface is the only result path: the CLI claims it before network work, reports liveness on stderr, and atomically publishes the final JSON only after retrieval completes. The caller resumes the same running process and treats that file as the single source of truth, eliminating duplicate retrieval, partial output, and overwritten evidence.
