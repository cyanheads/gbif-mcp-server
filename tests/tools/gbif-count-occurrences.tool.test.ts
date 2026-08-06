/**
 * @fileoverview Tests for gbif_count_occurrences tool.
 * @module tests/tools/gbif-count-occurrences.tool.test
 */

import { createMockContext, getEnrichment } from '@cyanheads/mcp-ts-core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { gbifCountOccurrences } from '@/mcp-server/tools/definitions/gbif-count-occurrences.tool.js';

vi.mock('@/services/gbif/gbif-service.js', () => ({
  getGbifService: vi.fn(),
}));

import { getGbifService } from '@/services/gbif/gbif-service.js';

/** EOD – eBird Observation Dataset. */
const EBIRD_KEY = '4fa7b334-ce0d-4e88-aaae-2e0c138d049e';

describe('gbifCountOccurrences', () => {
  const mockCountOccurrences = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getGbifService).mockReturnValue({ countOccurrences: mockCountOccurrences } as never);
  });

  it('returns count for taxon + country filters', async () => {
    mockCountOccurrences.mockResolvedValue(42000);

    const ctx = createMockContext();
    const input = gbifCountOccurrences.input.parse({ taxonKey: 5231190, country: 'GB' });
    const result = await gbifCountOccurrences.handler(input, ctx);

    expect(result.count).toBe(42000);
    expect(mockCountOccurrences).toHaveBeenCalledWith(
      expect.objectContaining({ taxonKey: 5231190, country: 'GB' }),
      ctx,
    );
  });

  it('returns count with no filters', async () => {
    mockCountOccurrences.mockResolvedValue(2400000000);

    const ctx = createMockContext();
    const input = gbifCountOccurrences.input.parse({});
    const result = await gbifCountOccurrences.handler(input, ctx);

    expect(result.count).toBe(2400000000);
  });

  it('returns zero count', async () => {
    mockCountOccurrences.mockResolvedValue(0);

    const ctx = createMockContext();
    const input = gbifCountOccurrences.input.parse({ taxonKey: 9999999 });
    const result = await gbifCountOccurrences.handler(input, ctx);

    expect(result.count).toBe(0);
  });

  it('passes isGeoreferenced filter', async () => {
    mockCountOccurrences.mockResolvedValue(1000);

    const ctx = createMockContext();
    const input = gbifCountOccurrences.input.parse({ isGeoreferenced: true });
    await gbifCountOccurrences.handler(input, ctx);

    expect(mockCountOccurrences).toHaveBeenCalledWith(
      expect.objectContaining({ isGeoreferenced: true }),
      ctx,
    );
  });

  it('passes datasetKey and year filters', async () => {
    mockCountOccurrences.mockResolvedValue(500);

    const ctx = createMockContext({ errors: gbifCountOccurrences.errors });
    const input = gbifCountOccurrences.input.parse({
      datasetKey: EBIRD_KEY,
      year: '2020,2024',
    });
    await gbifCountOccurrences.handler(input, ctx);

    expect(mockCountOccurrences).toHaveBeenCalledWith(
      expect.objectContaining({ datasetKey: EBIRD_KEY, year: '2020,2024' }),
      ctx,
    );
  });

  /**
   * A malformed dataset key is rejected before any request so the failure carries
   * this tool's recovery hint rather than arriving as a bare upstream 400 (#38).
   */
  it('rejects a non-UUID datasetKey without issuing a request', async () => {
    const ctx = createMockContext({ errors: gbifCountOccurrences.errors });
    const input = gbifCountOccurrences.input.parse({ datasetKey: 'eBird' });

    const err = await gbifCountOccurrences.handler(input, ctx).catch((e: unknown) => e);

    expect(err).toMatchObject({ data: { reason: 'invalid_filter' } });
    expect((err as { data: { recovery?: { hint?: string } } }).data.recovery?.hint).toContain(
      'gbif_search_datasets',
    );
    expect(mockCountOccurrences).not.toHaveBeenCalled();
  });

  /**
   * #36 — GBIF counts absence records alongside sightings, and for some taxa they
   * dominate: taxonKey 2263005 (Radicipes gracilis) is 2,351,582 records of which
   * 79 are PRESENT. The count tool therefore filters to PRESENT unless told
   * otherwise, matching gbif_search_occurrences so the two never disagree.
   */
  it('filters to PRESENT by default and says so', async () => {
    mockCountOccurrences.mockResolvedValue(79);

    const ctx = createMockContext();
    const input = gbifCountOccurrences.input.parse({ taxonKey: 2263005 });
    const result = await gbifCountOccurrences.handler(input, ctx);

    expect(result.count).toBe(79);
    expect(mockCountOccurrences).toHaveBeenCalledWith(
      expect.objectContaining({ occurrenceStatus: 'PRESENT' }),
      ctx,
    );

    const enrichment = getEnrichment(ctx);
    expect(enrichment.occurrenceStatus).toBe('PRESENT');
    expect(enrichment.notice).toContain('Absence records');
    expect(enrichment.notice).toContain('ANY');
  });

  /**
   * GBIF has no term meaning "either", so ANY has to reach the service as an
   * omitted parameter — sending the literal string draws HTTP 400.
   */
  it('omits the filter entirely for ANY and drops the exclusion notice', async () => {
    mockCountOccurrences.mockResolvedValue(2351582);

    const ctx = createMockContext();
    const input = gbifCountOccurrences.input.parse({
      taxonKey: 2263005,
      occurrenceStatus: 'ANY',
    });
    const result = await gbifCountOccurrences.handler(input, ctx);

    expect(result.count).toBe(2351582);
    expect(mockCountOccurrences).toHaveBeenCalledWith(
      expect.not.objectContaining({ occurrenceStatus: expect.anything() }),
      ctx,
    );

    const enrichment = getEnrichment(ctx);
    expect(enrichment.occurrenceStatus).toBe('ANY');
    expect(enrichment.notice).toBeUndefined();
  });

  it('passes ABSENT through and announces that the count is not sightings', async () => {
    mockCountOccurrences.mockResolvedValue(2351503);

    const ctx = createMockContext();
    const input = gbifCountOccurrences.input.parse({
      taxonKey: 2263005,
      occurrenceStatus: 'ABSENT',
    });
    await gbifCountOccurrences.handler(input, ctx);

    expect(mockCountOccurrences).toHaveBeenCalledWith(
      expect.objectContaining({ occurrenceStatus: 'ABSENT' }),
      ctx,
    );
    expect(getEnrichment(ctx).notice).toContain('not sightings');
  });

  it('states the PRESENT default in the schema so tools/list carries it', () => {
    const described = gbifCountOccurrences.input.shape.occurrenceStatus.description ?? '';
    expect(described).toContain('PRESENT');
    expect(described).toContain('ANY');
    expect(gbifCountOccurrences.input.parse({}).occurrenceStatus).toBe('PRESENT');
  });

  // #37 — the IUCN filter reaches the service, and only as a category GBIF indexes.
  it('passes iucnRedListCategory to the service', async () => {
    mockCountOccurrences.mockResolvedValue(4989);

    const ctx = createMockContext();
    const input = gbifCountOccurrences.input.parse({
      taxonKey: 5219404,
      iucnRedListCategory: 'VU',
    });
    await gbifCountOccurrences.handler(input, ctx);

    expect(mockCountOccurrences).toHaveBeenCalledWith(
      expect.objectContaining({ iucnRedListCategory: 'VU' }),
      ctx,
    );
  });

  it('omits iucnRedListCategory when not provided', async () => {
    mockCountOccurrences.mockResolvedValue(0);

    const ctx = createMockContext();
    const input = gbifCountOccurrences.input.parse({ taxonKey: 5219404 });
    await gbifCountOccurrences.handler(input, ctx);

    expect(mockCountOccurrences).toHaveBeenCalledWith(
      expect.not.objectContaining({ iucnRedListCategory: expect.anything() }),
      ctx,
    );
  });

  /**
   * GBIF answers an unrecognized iucnRedListCategory with HTTP 200 and a count of
   * zero rather than an error, so the schema enum is the only thing standing
   * between a caller typo and a confident empty answer. NE is rejected on the same
   * grounds: it matches no record in the index.
   */
  it('rejects a category GBIF would answer with a silent zero', () => {
    expect(() => gbifCountOccurrences.input.parse({ iucnRedListCategory: 'VULNERABLE' })).toThrow();
    expect(() => gbifCountOccurrences.input.parse({ iucnRedListCategory: 'vu' })).toThrow();
    expect(() => gbifCountOccurrences.input.parse({ iucnRedListCategory: 'NE' })).toThrow();
    expect(() => gbifCountOccurrences.input.parse({ iucnRedListCategory: 'VU' })).not.toThrow();
  });

  it('rejects an occurrenceStatus outside the accepted three', () => {
    expect(() => gbifCountOccurrences.input.parse({ occurrenceStatus: 'BOGUS' })).toThrow();
    expect(() => gbifCountOccurrences.input.parse({ occurrenceStatus: 'present' })).toThrow();
  });

  /**
   * #48 — a caller scoping a count to a dataset is the one most likely to set it
   * against the dataset tools' recordCount, which spans every occurrenceStatus.
   * The pointer has to run in this direction too, not only from the dataset side.
   */
  it('warns on datasetKey that the dataset recordCount is scoped differently', () => {
    const description = gbifCountOccurrences.input.shape.datasetKey.description ?? '';

    expect(description).toContain('recordCount');
    expect(description).toContain('occurrenceStatus');
  });

  it('formats count as text', () => {
    const blocks = gbifCountOccurrences.format!({ count: 42000 });
    const text = blocks[0].type === 'text' ? blocks[0].text : '';
    expect(text).toContain('42000');
  });
});
