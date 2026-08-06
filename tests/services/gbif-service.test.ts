/**
 * @fileoverview Tests for GbifService outbound request headers — the identifying
 * User-Agent GBIF asks integrators to send, and its GBIF_USER_AGENT override.
 * @module tests/services/gbif-service.test
 */

import type { AppConfig } from '@cyanheads/mcp-ts-core/config';
import type { StorageService } from '@cyanheads/mcp-ts-core/storage';
import { createMockContext } from '@cyanheads/mcp-ts-core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GbifService } from '@/services/gbif/gbif-service.js';

const REPOSITORY_URL = 'https://github.com/cyanheads/gbif-biodiversity-mcp-server';

/**
 * Deliberately unlike the real package version: if the User-Agent ever goes
 * back to a literal baked into `src/`, these assertions fail instead of
 * silently passing on a string that will drift at the next release.
 */
const TEST_VERSION = '9.9.9-test';

const appConfig = {
  mcpServerName: 'gbif-biodiversity-mcp-server',
  mcpServerVersion: TEST_VERSION,
} as AppConfig;

const storage = {} as StorageService;

let fetchMock: ReturnType<typeof vi.fn>;

function makeService(userAgent?: string): GbifService {
  return new GbifService(appConfig, storage, {
    baseUrl: 'https://api.gbif.org/v1',
    timeoutMs: 1_000,
    userAgent,
  });
}

/** Headers of the single fetch the service issued. */
function sentHeaders(): Record<string, string> {
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
  return init.headers as Record<string, string>;
}

describe('GbifService request headers', () => {
  beforeEach(() => {
    fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ usageKey: 2435099 }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('identifies the server by name, version, and repository URL', async () => {
    const ctx = createMockContext();
    await makeService().matchSpecies({ name: 'Puma concolor' }, ctx);

    expect(sentHeaders()['User-Agent']).toBe(
      `gbif-biodiversity-mcp-server/${TEST_VERSION} (+${REPOSITORY_URL})`,
    );
  });

  it('takes the version from config rather than a literal in src', async () => {
    const ctx = createMockContext();
    const service = new GbifService(
      { ...appConfig, mcpServerVersion: '1.2.3-other' } as AppConfig,
      storage,
      { baseUrl: 'https://api.gbif.org/v1', timeoutMs: 1_000 },
    );
    await service.getSpecies(2435099, ctx);

    expect(sentHeaders()['User-Agent']).toContain('/1.2.3-other ');
    expect(sentHeaders()['User-Agent']).not.toContain(TEST_VERSION);
  });

  it('sends a configured User-Agent verbatim instead of the built-in one', async () => {
    const ctx = createMockContext();
    const override = 'acme-biodiversity-atlas/2.0 (+mailto:ops@acme.example)';
    await makeService(override).searchOccurrences({ taxonKey: 2435099 }, ctx);

    expect(sentHeaders()['User-Agent']).toBe(override);
  });

  it('still requests JSON', async () => {
    const ctx = createMockContext();
    await makeService().countOccurrences({ taxonKey: 2435099 }, ctx);

    expect(sentHeaders().Accept).toBe('application/json');
  });
});
