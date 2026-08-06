/**
 * @fileoverview Guards the two surfaces that once advertised a GBIF API key.
 * GBIF issues none, and the `createApp({ instructions })` string ships to every
 * client on `initialize` — a credential claim there sends agents hunting for a
 * key that cannot be obtained.
 * @module tests/credential-claims.test
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const API_KEY_MENTION = /api[\s_-]*keys?/i;

const read = (relative: string): string =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf-8');

describe('no GBIF API-key claim', () => {
  it('the entrypoint carries an instructions string', () => {
    expect(read('../src/index.ts')).toMatch(/instructions:\s*\n?\s*'Use the gbif_\* tools/);
  });

  it('the instructions string offers no API key', () => {
    expect(read('../src/index.ts')).not.toMatch(API_KEY_MENTION);
  });

  it('the README offers no API key', () => {
    expect(read('../README.md')).not.toMatch(API_KEY_MENTION);
  });
});
