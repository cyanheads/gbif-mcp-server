/**
 * @fileoverview Tests for server-config env parsing — GBIF_USER_AGENT normalization,
 * plus the entrypoint wiring that carries the parsed value to the service. The
 * entrypoint calls `createApp()` at module scope, so it is read as source rather
 * than imported.
 * @module tests/config/server-config.test
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';

/** Re-imports the module so its memoized config is re-parsed against the stubbed env. */
async function loadUserAgent(value: string | undefined): Promise<string | undefined> {
  vi.resetModules();
  vi.stubEnv('GBIF_USER_AGENT', value);
  const { getServerConfig } = await import('@/config/server-config.js');
  return getServerConfig().userAgent;
}

describe('GBIF_USER_AGENT', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('is undefined when unset, so the service composes its own identifier', async () => {
    await expect(loadUserAgent(undefined)).resolves.toBeUndefined();
  });

  it('normalizes a blank value to undefined rather than sending an empty header', async () => {
    await expect(loadUserAgent('   ')).resolves.toBeUndefined();
  });

  it('trims surrounding whitespace off a configured value', async () => {
    await expect(loadUserAgent('  atlas/1.0 (+https://example.org)  ')).resolves.toBe(
      'atlas/1.0 (+https://example.org)',
    );
  });

  it('reaches the service — the entrypoint threads it into initGbifService', () => {
    const source = readFileSync(
      fileURLToPath(new URL('../../src/index.ts', import.meta.url)),
      'utf-8',
    );
    const call = /initGbifService\([\s\S]*?\}\);/.exec(source)?.[0];
    expect(call).toBeDefined();
    expect(call).toContain('userAgent: cfg.userAgent');
  });
});
