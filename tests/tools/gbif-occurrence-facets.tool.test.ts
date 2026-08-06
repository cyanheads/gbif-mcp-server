/**
 * @fileoverview Tests for gbif_occurrence_facets tool.
 * @module tests/tools/gbif-occurrence-facets.tool.test
 */

import { createMockContext, getEnrichment } from '@cyanheads/mcp-ts-core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { gbifOccurrenceFacets } from '@/mcp-server/tools/definitions/gbif-occurrence-facets.tool.js';

vi.mock('@/services/gbif/gbif-service.js', () => ({
  getGbifService: vi.fn(),
}));

import { getGbifService } from '@/services/gbif/gbif-service.js';

describe('gbifOccurrenceFacets', () => {
  const mockGetOccurrenceFacets = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getGbifService).mockReturnValue({
      getOccurrenceFacets: mockGetOccurrenceFacets,
    } as never);
  });

  it('returns facet counts ranked by count and enriches facetLimit', async () => {
    mockGetOccurrenceFacets.mockResolvedValue({
      count: 5000000,
      facets: [
        {
          field: 'COUNTRY',
          counts: [
            { name: 'GB', count: 1200000 },
            { name: 'DE', count: 900000 },
            { name: 'US', count: 750000 },
          ],
        },
      ],
    });

    const ctx = createMockContext();
    const input = gbifOccurrenceFacets.input.parse({ facet: 'COUNTRY', taxonKey: 5231190 });
    const result = await gbifOccurrenceFacets.handler(input, ctx);

    expect(result.facet).toBe('COUNTRY');
    expect(result.totalOccurrences).toBe(5000000);
    expect(result.counts).toHaveLength(3);
    expect(result.counts[0]).toEqual({ name: 'GB', count: 1200000 });
    expect(result.counts[1]).toEqual({ name: 'DE', count: 900000 });

    const enrichment = getEnrichment(ctx);
    expect(enrichment.facetLimit).toBe(10); // default
    expect(enrichment.facetOffset).toBe(0); // default
    expect(enrichment.moreValuesLikely).toBe(false); // 3 counts < facetLimit 10
    // The PRESENT default is announced, so a populated aggregation still carries a notice.
    expect(enrichment.occurrenceStatus).toBe('PRESENT');
    expect(enrichment.notice).toContain('Absence records');
  });

  it('enriches with notice when no facet data returned', async () => {
    mockGetOccurrenceFacets.mockResolvedValue({ count: 0, facets: [] });

    const ctx = createMockContext();
    const input = gbifOccurrenceFacets.input.parse({ facet: 'YEAR' });
    const result = await gbifOccurrenceFacets.handler(input, ctx);

    expect(result.counts).toHaveLength(0);
    expect(result.totalOccurrences).toBe(0);

    const enrichment = getEnrichment(ctx);
    expect(enrichment.notice).toBeDefined();
    expect(enrichment.notice).toContain('No facet values returned');
  });

  it('case-insensitive facet field matching', async () => {
    mockGetOccurrenceFacets.mockResolvedValue({
      count: 100,
      facets: [
        {
          field: 'country', // lowercase from API
          counts: [{ name: 'SE', count: 100 }],
        },
      ],
    });

    const ctx = createMockContext();
    const input = gbifOccurrenceFacets.input.parse({ facet: 'COUNTRY' });
    const result = await gbifOccurrenceFacets.handler(input, ctx);

    expect(result.counts).toHaveLength(1);
    expect(result.counts[0].name).toBe('SE');
  });

  it('returns empty counts when facet field not present in response', async () => {
    mockGetOccurrenceFacets.mockResolvedValue({
      count: 50,
      facets: [{ field: 'YEAR', counts: [{ name: '2024', count: 50 }] }],
    });

    const ctx = createMockContext();
    // Ask for COUNTRY but response only has YEAR
    const input = gbifOccurrenceFacets.input.parse({ facet: 'COUNTRY' });
    const result = await gbifOccurrenceFacets.handler(input, ctx);

    expect(result.counts).toHaveLength(0);
  });

  it('handles null name and count in facet entries', async () => {
    mockGetOccurrenceFacets.mockResolvedValue({
      count: 10,
      facets: [
        {
          field: 'YEAR',
          counts: [{ name: null, count: null }],
        },
      ],
    });

    const ctx = createMockContext();
    const input = gbifOccurrenceFacets.input.parse({ facet: 'YEAR' });
    const result = await gbifOccurrenceFacets.handler(input, ctx);

    expect(result.counts[0].name).toBe('');
    expect(result.counts[0].count).toBe(0);
  });

  it('formats output with facet name and counts', () => {
    const output = {
      facet: 'COUNTRY',
      totalOccurrences: 5000000,
      counts: [
        { name: 'GB', count: 1200000 },
        { name: 'DE', count: 900000 },
      ],
    };
    const blocks = gbifOccurrenceFacets.format!(output);
    const text = blocks[0].type === 'text' ? blocks[0].text : '';
    expect(text).toContain('COUNTRY');
    expect(text).toContain('5000000');
    expect(text).toContain('GB');
    expect(text).toContain('1,200,000');
    expect(text).toContain('DE');
  });

  it('formats empty counts without error', () => {
    const blocks = gbifOccurrenceFacets.format!({ facet: 'YEAR', totalOccurrences: 0, counts: [] });
    const text = blocks[0].type === 'text' ? blocks[0].text : '';
    expect(text).toContain('YEAR');
    expect(text).toContain('0');
    // #39: "Top 0 values" read as a defect rather than an empty result.
    expect(text).not.toMatch(/Top 0/i);
    expect(text).toMatch(/No facet values/i);
  });

  /**
   * #39 — the rendered values are the top facetLimit only at facetOffset 0. Live check:
   * COUNTRY on taxonKey 5219404 unpaged gives ZA, KE, TZ, BW, NA, BJ; facetOffset=3 with
   * facetLimit=3 returns BW, NA, BJ — ranks 4-6, which "Top 3 values" misdescribes.
   */
  it('does not claim the rendered values are the top N (issue #39)', () => {
    const blocks = gbifOccurrenceFacets.format!({
      facet: 'COUNTRY',
      totalOccurrences: 19078,
      counts: [
        { name: 'BW', count: 1401 },
        { name: 'NA', count: 861 },
        { name: 'BJ', count: 682 },
      ],
    });
    const text = blocks[0].type === 'text' ? blocks[0].text : '';

    expect(text).not.toMatch(/Top 3 values/i);
    expect(text).toMatch(/facetOffset/i);
    expect(text).toContain('BW');
  });

  // #10: percentages use totalOccurrences, not maxCount, and label is "% of total"
  it('formats percentages as share of total, not share of top', () => {
    const output = {
      facet: 'YEAR',
      totalOccurrences: 1609491,
      counts: [
        { name: '2025', count: 117329 },
        { name: '2006', count: 51955 },
      ],
    };
    const blocks = gbifOccurrenceFacets.format!(output);
    const text = blocks[0].type === 'text' ? blocks[0].text : '';
    // 117329 / 1609491 ≈ 7.3%, not 100%
    expect(text).not.toContain('100%');
    expect(text).toContain('% of total');
    expect(text).not.toContain('% of top');
    // 51955 / 1609491 ≈ 3.2%, not 44%
    expect(text).not.toContain('44%');
  });

  // #11: STATE_PROVINCE is a valid facet dimension
  it('accepts STATE_PROVINCE as a facet dimension', () => {
    expect(() => gbifOccurrenceFacets.input.parse({ facet: 'STATE_PROVINCE' })).not.toThrow();
  });

  // #25: datasetKey scopes the aggregation and is passed to the service
  it('passes datasetKey to the service', async () => {
    mockGetOccurrenceFacets.mockResolvedValue({
      count: 3112676,
      facets: [{ field: 'COUNTRY', counts: [{ name: 'GB', count: 815887 }] }],
    });

    const ctx = createMockContext();
    const input = gbifOccurrenceFacets.input.parse({
      facet: 'COUNTRY',
      taxonKey: 9705453,
      datasetKey: '4fa7b334-ce0d-4e88-aaae-2e0c138d049e',
    });
    await gbifOccurrenceFacets.handler(input, ctx);

    expect(mockGetOccurrenceFacets).toHaveBeenCalledWith(
      expect.objectContaining({ datasetKey: '4fa7b334-ce0d-4e88-aaae-2e0c138d049e' }),
      ctx,
    );
  });

  it('omits datasetKey when not provided', async () => {
    mockGetOccurrenceFacets.mockResolvedValue({ count: 0, facets: [] });

    const ctx = createMockContext();
    const input = gbifOccurrenceFacets.input.parse({ facet: 'COUNTRY' });
    await gbifOccurrenceFacets.handler(input, ctx);

    expect(mockGetOccurrenceFacets).toHaveBeenCalledWith(
      expect.not.objectContaining({ datasetKey: expect.anything() }),
      ctx,
    );
  });

  // #32: facetOffset pages past the first facetLimit values
  it('passes facetOffset to the service and echoes it in enrichment', async () => {
    mockGetOccurrenceFacets.mockResolvedValue({
      count: 3112676,
      facets: [
        {
          field: 'DATASET_KEY',
          counts: [
            { name: 'ds-4', count: 4000 },
            { name: 'ds-5', count: 3000 },
            { name: 'ds-6', count: 2000 },
          ],
        },
      ],
    });

    const ctx = createMockContext();
    const input = gbifOccurrenceFacets.input.parse({
      facet: 'DATASET_KEY',
      facetLimit: 3,
      facetOffset: 3,
    });
    await gbifOccurrenceFacets.handler(input, ctx);

    expect(mockGetOccurrenceFacets).toHaveBeenCalledWith(
      expect.objectContaining({ facetLimit: 3, facetOffset: 3 }),
      ctx,
    );
    expect(getEnrichment(ctx).facetOffset).toBe(3);
  });

  it('defaults facetOffset to 0 and passes it to the service', async () => {
    mockGetOccurrenceFacets.mockResolvedValue({ count: 0, facets: [] });

    const ctx = createMockContext();
    const input = gbifOccurrenceFacets.input.parse({ facet: 'DATASET_KEY' });
    await gbifOccurrenceFacets.handler(input, ctx);

    expect(mockGetOccurrenceFacets).toHaveBeenCalledWith(
      expect.objectContaining({ facetOffset: 0 }),
      ctx,
    );
  });

  it('flags moreValuesLikely when the page fills facetLimit', async () => {
    mockGetOccurrenceFacets.mockResolvedValue({
      count: 3112676,
      facets: [
        {
          field: 'DATASET_KEY',
          counts: [
            { name: 'ds-1', count: 9000 },
            { name: 'ds-2', count: 8000 },
            { name: 'ds-3', count: 7000 },
          ],
        },
      ],
    });

    const ctx = createMockContext();
    const input = gbifOccurrenceFacets.input.parse({ facet: 'DATASET_KEY', facetLimit: 3 });
    await gbifOccurrenceFacets.handler(input, ctx);

    expect(getEnrichment(ctx).moreValuesLikely).toBe(true);
  });

  it('does not flag moreValuesLikely when the page is not full', async () => {
    mockGetOccurrenceFacets.mockResolvedValue({
      count: 100,
      facets: [{ field: 'DATASET_KEY', counts: [{ name: 'ds-1', count: 100 }] }],
    });

    const ctx = createMockContext();
    const input = gbifOccurrenceFacets.input.parse({ facet: 'DATASET_KEY', facetLimit: 3 });
    await gbifOccurrenceFacets.handler(input, ctx);

    expect(getEnrichment(ctx).moreValuesLikely).toBe(false);
  });
});

/**
 * #36/#37 — two dimensions GBIF facets on but this tool did not offer, plus the
 * presence/absence scope that keeps the aggregation agreeing with
 * gbif_count_occurrences on the same filters.
 */
describe('gbifOccurrenceFacets occurrenceStatus and IUCN dimensions', () => {
  const mockGetOccurrenceFacets = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getGbifService).mockReturnValue({
      getOccurrenceFacets: mockGetOccurrenceFacets,
    } as never);
    mockGetOccurrenceFacets.mockResolvedValue({ count: 0, facets: [] });
  });

  it('accepts OCCURRENCE_STATUS and IUCN_RED_LIST_CATEGORY as dimensions', () => {
    expect(() => gbifOccurrenceFacets.input.parse({ facet: 'OCCURRENCE_STATUS' })).not.toThrow();
    expect(() =>
      gbifOccurrenceFacets.input.parse({ facet: 'IUCN_RED_LIST_CATEGORY' }),
    ).not.toThrow();
  });

  it('scopes to PRESENT by default and announces it', async () => {
    const ctx = createMockContext();
    const input = gbifOccurrenceFacets.input.parse({ facet: 'COUNTRY', taxonKey: 5219404 });
    await gbifOccurrenceFacets.handler(input, ctx);

    expect(mockGetOccurrenceFacets).toHaveBeenCalledWith(
      expect.objectContaining({ occurrenceStatus: 'PRESENT' }),
      ctx,
    );
    expect(getEnrichment(ctx).occurrenceStatus).toBe('PRESENT');
  });

  /**
   * The default would collapse an OCCURRENCE_STATUS aggregation to one bucket, so
   * ANY has to reach the service as an omitted parameter for the split to be
   * measurable in a single call.
   */
  it('omits the scope for ANY so both buckets are measurable in one call', async () => {
    mockGetOccurrenceFacets.mockResolvedValue({
      count: 2351582,
      facets: [
        {
          field: 'OCCURRENCE_STATUS',
          counts: [
            { name: 'ABSENT', count: 2351503 },
            { name: 'PRESENT', count: 79 },
          ],
        },
      ],
    });

    const ctx = createMockContext();
    const input = gbifOccurrenceFacets.input.parse({
      facet: 'OCCURRENCE_STATUS',
      taxonKey: 2263005,
      occurrenceStatus: 'ANY',
    });
    const result = await gbifOccurrenceFacets.handler(input, ctx);

    expect(mockGetOccurrenceFacets).toHaveBeenCalledWith(
      expect.not.objectContaining({ occurrenceStatus: expect.anything() }),
      ctx,
    );
    expect(result.counts).toHaveLength(2);
    expect(getEnrichment(ctx).notice).toBeUndefined();
  });

  it('keeps the empty-facet guidance alongside the scope announcement', async () => {
    const ctx = createMockContext();
    const input = gbifOccurrenceFacets.input.parse({ facet: 'YEAR' });
    await gbifOccurrenceFacets.handler(input, ctx);

    const notice = getEnrichment(ctx).notice as string;
    expect(notice).toContain('No facet values returned');
    expect(notice).toContain('Absence records');
  });

  it('passes iucnRedListCategory as a scope and omits it when unset', async () => {
    const ctx = createMockContext();
    await gbifOccurrenceFacets.handler(
      gbifOccurrenceFacets.input.parse({ facet: 'COUNTRY', iucnRedListCategory: 'EN' }),
      ctx,
    );
    expect(mockGetOccurrenceFacets).toHaveBeenCalledWith(
      expect.objectContaining({ iucnRedListCategory: 'EN' }),
      ctx,
    );

    vi.clearAllMocks();
    mockGetOccurrenceFacets.mockResolvedValue({ count: 0, facets: [] });
    const ctx2 = createMockContext();
    await gbifOccurrenceFacets.handler(
      gbifOccurrenceFacets.input.parse({ facet: 'COUNTRY' }),
      ctx2,
    );
    expect(mockGetOccurrenceFacets).toHaveBeenCalledWith(
      expect.not.objectContaining({ iucnRedListCategory: expect.anything() }),
      ctx2,
    );
  });

  /** GBIF answers an unrecognized category with a silent zero, so the enum is the guard. */
  it('rejects scope values GBIF would answer with a silent zero', () => {
    expect(() =>
      gbifOccurrenceFacets.input.parse({ facet: 'COUNTRY', iucnRedListCategory: 'NE' }),
    ).toThrow();
    expect(() =>
      gbifOccurrenceFacets.input.parse({ facet: 'COUNTRY', occurrenceStatus: 'BOGUS' }),
    ).toThrow();
  });
});
