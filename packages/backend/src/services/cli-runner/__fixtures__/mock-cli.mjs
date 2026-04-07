#!/usr/bin/env node
/**
 * Mock CLI script that emits JSONL events on stdout, simulating a Claude-like CLI.
 * Usage: node mock-cli.mjs [--fail] [--hang] [--plan]
 *
 * Used by integration tests to verify the full SSE pipeline without a real CLI.
 */

const args = process.argv.slice(2);
const shouldFail = args.includes('--fail');
const shouldHang = args.includes('--hang');
const shouldPlan = args.includes('--plan');

function emit(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function run() {
  // Emit a progress/status event
  emit({ type: 'system', message: 'Mock CLI started' });
  await sleep(50);

  if (shouldFail) {
    emit({ type: 'error', error: 'Simulated failure' });
    process.exit(1);
  }

  if (shouldHang) {
    // Just hang indefinitely — watchdog should kill us
    await new Promise(() => {});
  }

  // Emit assistant text
  emit({
    type: 'assistant',
    message: {
      content: [{ type: 'text', text: 'Here is my analysis of the codebase.' }],
    },
  });
  await sleep(50);

  // Emit some tool use
  emit({ type: 'tool_use', tool_name: 'Read' });
  await sleep(50);

  // Emit more text
  emit({
    type: 'content_block_delta',
    delta: { type: 'text_delta', text: ' The project uses TypeScript.' },
  });
  await sleep(50);

  if (shouldPlan) {
    emit({
      type: 'assistant',
      message: {
        content: [{
          type: 'text',
          text: `# Implementation Plan

## Summary
This plan adds authentication to the API.

## Approach
Use JWT tokens with bcrypt password hashing.

## Steps
1. Install jsonwebtoken and bcrypt
2. Create auth middleware
3. Add login/register routes

## Estimated Effort
Medium - requires changes to multiple files.

## Risks
- Token expiry handling needs testing
- Password reset flow not included`,
        }],
      },
    });
  }

  // Emit result
  emit({
    type: 'result',
    result: 'Analysis complete.',
  });

  process.exit(0);
}

run();
