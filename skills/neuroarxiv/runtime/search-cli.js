#!/usr/bin/env node
import { searchEvidence } from "./search-command.js";
searchEvidence(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
});
