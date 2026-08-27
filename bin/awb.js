#!/usr/bin/env node

import { run } from "../core/cli.js";

try {
  const outcome = await run(process.argv.slice(2));
  if (outcome?.exitCode) process.exitCode = outcome.exitCode;
} catch (error) {
  process.stderr.write(`Error: ${error.message}\n`);
  process.exitCode = 1;
}
