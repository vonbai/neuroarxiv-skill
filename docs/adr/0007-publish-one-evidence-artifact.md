# Publish one owned Evidence Artifact

Each Research Run assigns one Retrieval Owner to one fresh Evidence Artifact path. The CLI claims that path before network work, reports liveness on stderr, and atomically publishes the final JSON only after retrieval completes; the caller resumes the same running process and treats the file as the single source of truth. This prevents an empty initial stdout chunk from being mistaken for completion while rejecting duplicate retrieval and partial or overwritten evidence.
