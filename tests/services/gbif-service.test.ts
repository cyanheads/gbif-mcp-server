/**
 * @fileoverview Tests for GbifService transport behavior — the identifying
 * User-Agent GBIF asks integrators to send, the error payload a non-2xx response
 * produces, and how a request deadline is classified.
 * @module tests/services/gbif-service.test
 */

import type { AppConfig } from '@cyanheads/mcp-ts-core/config';
import { JsonRpcErrorCode, McpError } from '@cyanheads/mcp-ts-core/errors';
import type { StorageService } from '@cyanheads/mcp-ts-core/storage';
import { createMockContext } from '@cyanheads/mcp-ts-core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { gbifGetDataset } from '@/mcp-server/tools/definitions/gbif-get-dataset.tool.js';
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

/**
 * #38 — an upstream rejection has to arrive as one self-explanatory error: the
 * cause in the message (so `content[]` clients see it, not just
 * `structuredContent`), a recovery hint, and no trace of the outbound URL.
 */
describe('GbifService upstream error payload', () => {
  /** GBIF's verbatim body for an unclosed WKT ring. */
  const WKT_BODY =
    'Invalid shape in WKT: POLYGON((0 0, 1 1)) Points of LinearRing do not form a closed linestring';
  const REQUEST_URL =
    'https://api.gbif.org/v1/occurrence/search?taxonKey=1&geometry=POLYGON%28%280+0%2C+1+1%29%29&limit=1';

  /** Response the way `fetch` hands one back — `url` populated by the runtime. */
  function upstream(status: number, body: string, statusText: string): Response {
    const response = new Response(body, { status, statusText });
    Object.defineProperty(response, 'url', { value: REQUEST_URL });
    return response;
  }

  function makeService(): GbifService {
    return new GbifService(appConfig, storage, {
      baseUrl: 'https://api.gbif.org/v1',
      timeoutMs: 1_000,
    });
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function searchAndCatch(response: Response, ctx = createMockContext()): Promise<McpError> {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));
    const err = await makeService()
      .searchOccurrences({ geometry: 'POLYGON((0 0, 1 1))' }, ctx)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(McpError);
    return err as McpError;
  }

  it('keeps the request URL out of the error payload', async () => {
    const err = await searchAndCatch(upstream(400, WKT_BODY, 'Bad Request'));

    expect(err.data).not.toHaveProperty('url');
    expect(JSON.stringify(err.data)).not.toContain('api.gbif.org');
    expect(JSON.stringify(err.data)).not.toContain('taxonKey=1');
    // The fields withRetry and the callers classify on survive the removal.
    expect(err.data).toMatchObject({ status: 400, body: WKT_BODY });
  });

  it("states GBIF's explanation in the message, not only in data.body", async () => {
    const err = await searchAndCatch(upstream(400, WKT_BODY, 'Bad Request'));

    expect(err.message).toContain('HTTP 400');
    expect(err.message).toContain('Points of LinearRing do not form a closed linestring');
  });

  it('carries the invalid_filter reason and a recovery hint on a 400', async () => {
    const err = await searchAndCatch(upstream(400, WKT_BODY, 'Bad Request'));
    const data = err.data as { reason?: string; recovery?: { hint?: string } };

    expect(err.code).toBe(JsonRpcErrorCode.InvalidParams);
    expect(data.reason).toBe('invalid_filter');
    expect(data.recovery?.hint).toBeTruthy();
  });

  it("prefers the calling definition's recovery wording over the service default", async () => {
    const ctx = createMockContext({ errors: gbifGetDataset.errors });
    const err = await searchAndCatch(
      upstream(400, 'Invalid UUID string: not-a-uuid', 'Bad Request'),
      ctx,
    );
    const data = err.data as { recovery?: { hint?: string } };

    expect(data.recovery?.hint).toBe(
      gbifGetDataset.errors?.find((e) => e.reason === 'invalid_filter')?.recovery,
    );
  });

  it('leaves a non-400 unclassified as a filter problem but still drops the URL', async () => {
    const err = await searchAndCatch(upstream(500, 'Internal Server Error', 'Server Error'));
    const data = err.data as { reason?: string; recovery?: unknown };

    expect(err.code).toBe(JsonRpcErrorCode.InternalError);
    expect(data.reason).toBeUndefined();
    expect(data.recovery).toBeUndefined();
    expect(err.data).not.toHaveProperty('url');
  });

  it('maps a 404 to NotFound so the not_found contracts still fire', async () => {
    const err = await searchAndCatch(upstream(404, 'Entity not found for uri: /', 'Not Found'));

    expect(err.code).toBe(JsonRpcErrorCode.NotFound);
  });

  it('keeps an HTML outage page out of the message', async () => {
    const page = '<!DOCTYPE html><html><body>429 Too Many Requests</body></html>';
    const err = await searchAndCatch(upstream(400, page, 'Bad Request'));

    expect(err.message).not.toContain('<html>');
    expect(err.message).not.toContain('<!DOCTYPE');
    expect(err.data).toMatchObject({ body: page });
  });
});

describe('GbifService request deadline', () => {
  /** A fetch that only settles when its signal aborts, rejecting with the reason. */
  function hangingFetch() {
    return vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          const signal = init.signal as AbortSignal;
          signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        }),
    );
  }

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  /**
   * A bare `controller.abort()` produced a raw AbortError — no code, no data, and
   * a message ("The operation was aborted") naming neither GBIF nor the deadline.
   */
  it('classifies its own deadline as a Timeout naming GBIF and the limit', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', hangingFetch());
    const service = new GbifService(appConfig, storage, {
      baseUrl: 'https://api.gbif.org/v1',
      timeoutMs: 10_000,
    });

    const pending = service.getSpecies(2435099, createMockContext()).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(120_000);
    const err = await pending;

    expect(err).toBeInstanceOf(McpError);
    expect((err as McpError).code).toBe(JsonRpcErrorCode.Timeout);
    expect((err as McpError).message).toContain('GBIF API request timed out after 10000ms');
    expect((err as McpError).data).toMatchObject({ timeoutMs: 10_000 });
  });

  /**
   * The dataset record count is supplementary, so it must not inherit the primary
   * client's retry budget or pacing — one attempt, then the field goes absent.
   */
  it('bounds the dataset occurrence count to a single attempt and degrades to undefined', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('connection reset'));
    vi.stubGlobal('fetch', fetchMock);
    const service = new GbifService(appConfig, storage, {
      baseUrl: 'https://api.gbif.org/v1',
      timeoutMs: 10_000,
    });

    const count = await service.getDatasetOccurrenceCount(
      '4fa7b334-ce0d-4e88-aaae-2e0c138d049e',
      createMockContext(),
    );

    expect(count).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
