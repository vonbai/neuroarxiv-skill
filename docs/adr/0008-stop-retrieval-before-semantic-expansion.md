# Stop retrieval failure before semantic expansion

Research Run treats every exhausted Search Attempt as a source-level Retrieval Failure, records its complete request chain, and stops before another category or expansion. Expansion remains a semantic recall mechanism used only after every initial request succeeds but coverage stays thin; this keeps bounded recovery, the wall-clock deadline, and failure meaning inside the deterministic deep module instead of distributing them across caller Agents.
