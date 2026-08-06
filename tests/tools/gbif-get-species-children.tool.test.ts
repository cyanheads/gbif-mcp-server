/**
 * @fileoverview Tests for gbif_get_species_children tool.
 * @module tests/tools/gbif-get-species-children.tool.test
 */

import { createMockContext, getEnrichment } from '@cyanheads/mcp-ts-core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { gbifGetSpeciesChildren } from '@/mcp-server/tools/definitions/gbif-get-species-children.tool.js';

vi.mock('@/services/gbif/gbif-service.js', () => ({
  getGbifService: vi.fn(),
}));

import { getGbifService } from '@/services/gbif/gbif-service.js';

describe('gbifGetSpeciesChildren', () => {
  const mockGetSpeciesChildren = vi.fn();
  const mockGetSpecies = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getGbifService).mockReturnValue({
      getSpeciesChildren: mockGetSpeciesChildren,
      getSpecies: mockGetSpecies,
    } as never);
  });

  it('returns children and enrichment with pagination metadata', async () => {
    mockGetSpeciesChildren.mockResolvedValue({
      results: [
        {
          key: 5231190,
          scientificName: 'Parus major Linnaeus, 1758',
          canonicalName: 'Parus major',
          rank: 'SPECIES',
          taxonomicStatus: 'ACCEPTED',
          vernacularName: 'Great Tit',
          numOccurrences: 5000000,
          numDescendants: 12,
        },
        {
          key: 5231191,
          scientificName: 'Parus minor Temminck & Schlegel, 1848',
          canonicalName: 'Parus minor',
          rank: 'SPECIES',
          taxonomicStatus: 'ACCEPTED',
        },
      ],
      offset: 0,
      limit: 20,
      endOfRecords: true,
    });

    const ctx = createMockContext({ errors: gbifGetSpeciesChildren.errors });
    const input = gbifGetSpeciesChildren.input.parse({ taxonKey: 2492278 });
    const result = await gbifGetSpeciesChildren.handler(input, ctx);

    expect(result.children).toHaveLength(2);
    expect(result.children[0].key).toBe(5231190);
    expect(result.children[0].canonicalName).toBe('Parus major');
    expect(result.children[0].vernacularName).toBe('Great Tit');
    expect(result.children[0].numOccurrences).toBe(5000000);

    const enrichment = getEnrichment(ctx);
    // GBIF's /children response carries no total count, so none is surfaced (issue #3).
    expect(enrichment.totalCount).toBeUndefined();
    expect(enrichment.endOfRecords).toBe(true);
    expect(enrichment.offset).toBe(0);
    expect(enrichment.limit).toBe(20);
    expect(enrichment.notice).toBeUndefined();
    // Final page — no truncation disclosed.
    expect(enrichment.truncated).toBeUndefined();
  });

  // Regression for #3: the handler must not fabricate a totalCount from a `count` field
  // the /species/{key}/children endpoint never returns. Fixture mirrors the real GBIF
  // response shape exactly — results, offset, limit, endOfRecords; no count.
  it('omits totalCount and surfaces only genuine paging fields (issue #3)', async () => {
    mockGetSpeciesChildren.mockResolvedValue({
      results: [
        { key: 2487924, scientificName: 'Parus afer Linnaeus, 1766', canonicalName: 'Parus afer' },
        { key: 2487925, canonicalName: 'Parus albiventris' },
        { key: 2487926, canonicalName: 'Parus alpinus' },
      ],
      offset: 0,
      limit: 3,
      endOfRecords: false,
    });

    const ctx = createMockContext({ errors: gbifGetSpeciesChildren.errors });
    const input = gbifGetSpeciesChildren.input.parse({ taxonKey: 2487923, limit: 3 });
    const result = await gbifGetSpeciesChildren.handler(input, ctx);

    expect(result.children).toHaveLength(3);
    expect(result.children[0].canonicalName).toBe('Parus afer');

    const enrichment = getEnrichment(ctx);
    expect(enrichment).not.toHaveProperty('totalCount');
    expect(enrichment.totalCount).toBeUndefined();
    expect(enrichment.offset).toBe(0);
    expect(enrichment.limit).toBe(3);
    expect(enrichment.endOfRecords).toBe(false);
    // More pages exist — disclose truncation honestly, without fabricating a total.
    expect(enrichment.truncated).toBe(true);
    expect(enrichment.shown).toBe(3);
    expect(enrichment.cap).toBe(3);
  });

  /**
   * #46 — the framework's default truncation notice tells the caller to narrow with
   * filters. /species/{key}/children takes none (it ignores a rank parameter outright),
   * so the guidance must name the offset to advance to instead.
   */
  it('names offset paging in the truncation notice, not filters (issue #46)', async () => {
    mockGetSpeciesChildren.mockResolvedValue({
      results: [
        { key: 1, canonicalName: 'A' },
        { key: 2, canonicalName: 'B' },
      ],
      offset: 4,
      limit: 2,
      endOfRecords: false,
    });

    const ctx = createMockContext({ errors: gbifGetSpeciesChildren.errors });
    const input = gbifGetSpeciesChildren.input.parse({ taxonKey: 2435194, limit: 2, offset: 4 });
    await gbifGetSpeciesChildren.handler(input, ctx);

    const notice = getEnrichment(ctx).notice as string;
    expect(notice).toContain('offset 6');
    expect(notice).toContain('limit');
    expect(notice).not.toMatch(/narrow with filters/i);
  });

  /**
   * #47 — GBIF answers 400 (not 404) for a taxonKey it cannot parse, e.g. a fraction
   * or a value past the 32-bit signed range, both of which the bare z.number() accepts.
   */
  it('propagates the upstream invalid_filter reason and declares it (issue #47)', async () => {
    const { McpError, JsonRpcErrorCode } = await import('@cyanheads/mcp-ts-core/errors');
    mockGetSpeciesChildren.mockRejectedValue(
      new McpError(
        JsonRpcErrorCode.InvalidParams,
        'GBIF API returned HTTP 400 Bad Request. For input string: "1.5"',
        { status: 400, reason: 'invalid_filter' },
      ),
    );

    const ctx = createMockContext({ errors: gbifGetSpeciesChildren.errors });
    const input = gbifGetSpeciesChildren.input.parse({ taxonKey: 1.5 });

    const err = await gbifGetSpeciesChildren.handler(input, ctx).catch((e: unknown) => e);
    expect(err).toMatchObject({ data: { reason: 'invalid_filter' } });

    const declared = gbifGetSpeciesChildren.errors?.find((e) => e.reason === 'invalid_filter');
    expect(declared?.code).toBe(JsonRpcErrorCode.InvalidParams);
    expect(declared?.recovery).toBeTruthy();
  });

  it('enriches with notice when valid taxon has no children', async () => {
    mockGetSpeciesChildren.mockResolvedValue({
      results: [],
      offset: 0,
      limit: 20,
      endOfRecords: true,
    });
    // Existence check succeeds — taxon exists but has no children
    mockGetSpecies.mockResolvedValue({
      key: 5231190,
      rank: 'SPECIES',
      canonicalName: 'Parus major',
    });

    const ctx = createMockContext({ errors: gbifGetSpeciesChildren.errors });
    const input = gbifGetSpeciesChildren.input.parse({ taxonKey: 5231190 });
    const result = await gbifGetSpeciesChildren.handler(input, ctx);

    expect(result.children).toHaveLength(0);
    const enrichment = getEnrichment(ctx);
    expect(enrichment.notice).toBeDefined();
    expect(enrichment.notice).toContain('no direct children');
  });

  it('throws not_found when empty results and taxon does not exist', async () => {
    mockGetSpeciesChildren.mockResolvedValue({
      results: [],
      offset: 0,
      limit: 20,
      endOfRecords: true,
    });
    // Existence check fails — key does not exist in the backbone
    const { McpError, JsonRpcErrorCode } = await import('@cyanheads/mcp-ts-core/errors');
    mockGetSpecies.mockRejectedValue(new McpError(JsonRpcErrorCode.NotFound, 'Not found'));

    const ctx = createMockContext({ errors: gbifGetSpeciesChildren.errors });
    const input = gbifGetSpeciesChildren.input.parse({ taxonKey: 999999999 });

    await expect(gbifGetSpeciesChildren.handler(input, ctx)).rejects.toMatchObject({
      data: { reason: 'not_found' },
    });
  });

  it('passes limit and offset to service', async () => {
    mockGetSpeciesChildren.mockResolvedValue({
      results: [],
      offset: 40,
      limit: 10,
      endOfRecords: true,
    });
    // Existence check succeeds
    mockGetSpecies.mockResolvedValue({ key: 100, rank: 'GENUS', canonicalName: 'TestGenus' });

    const ctx = createMockContext({ errors: gbifGetSpeciesChildren.errors });
    const input = gbifGetSpeciesChildren.input.parse({ taxonKey: 100, limit: 10, offset: 40 });
    await gbifGetSpeciesChildren.handler(input, ctx);

    expect(mockGetSpeciesChildren).toHaveBeenCalledWith(
      100,
      expect.objectContaining({ limit: 10, offset: 40 }),
      ctx,
    );
  });

  it('handles sparse child records', async () => {
    mockGetSpeciesChildren.mockResolvedValue({
      results: [{ key: 999 }],
      offset: 0,
      limit: 1,
      endOfRecords: true,
    });

    const ctx = createMockContext({ errors: gbifGetSpeciesChildren.errors });
    const input = gbifGetSpeciesChildren.input.parse({ taxonKey: 100 });
    const result = await gbifGetSpeciesChildren.handler(input, ctx);

    expect(result.children[0].key).toBe(999);
    expect(result.children[0].canonicalName).toBeUndefined();
    expect(result.children[0].vernacularName).toBeUndefined();
  });

  it('formats output with key fields', () => {
    const output = {
      children: [
        {
          key: 5231190,
          canonicalName: 'Parus major',
          scientificName: 'Parus major Linnaeus, 1758',
          rank: 'SPECIES',
          taxonomicStatus: 'ACCEPTED',
          vernacularName: 'Great Tit',
          numOccurrences: 5000000,
          numDescendants: 12,
        },
      ],
    };
    const blocks = gbifGetSpeciesChildren.format!(output);
    const text = blocks[0].type === 'text' ? blocks[0].text : '';
    expect(text).toContain('5231190');
    expect(text).toContain('Parus major');
  });

  /**
   * #39 — GBIF leaves canonicalName null on backbone entries whose names are not
   * parseable binomials (live: child 216995197 of "unclassified Coleoptera" has
   * scientificName "coleopteraJanzen01" and canonicalName null).
   */
  it('falls back to scientificName instead of printing Unknown (issue #39)', () => {
    const blocks = gbifGetSpeciesChildren.format!({
      children: [{ key: 216995197, scientificName: 'coleopteraJanzen01', rank: 'UNRANKED' }],
    });
    const text = blocks[0].type === 'text' ? blocks[0].text : '';

    expect(text).toContain('coleopteraJanzen01');
    expect(text).not.toContain('Unknown');
  });

  it('still prints Unknown when GBIF supplies no name at all', () => {
    const blocks = gbifGetSpeciesChildren.format!({ children: [{ key: 999 }] });
    const text = blocks[0].type === 'text' ? blocks[0].text : '';

    expect(text).toContain('Unknown');
  });
});
