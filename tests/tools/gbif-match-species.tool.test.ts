/**
 * @fileoverview Tests for gbif_match_species tool.
 * @module tests/tools/gbif-match-species.tool.test
 */

import { createMockContext, getEnrichment } from '@cyanheads/mcp-ts-core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { gbifMatchSpecies } from '@/mcp-server/tools/definitions/gbif-match-species.tool.js';

vi.mock('@/services/gbif/gbif-service.js', () => ({
  getGbifService: vi.fn(),
}));

import { getGbifService } from '@/services/gbif/gbif-service.js';

describe('gbifMatchSpecies', () => {
  const mockMatchSpecies = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getGbifService).mockReturnValue({ matchSpecies: mockMatchSpecies } as never);
  });

  it('returns matched taxon for a known species', async () => {
    mockMatchSpecies.mockResolvedValue({
      usageKey: 5231190,
      scientificName: 'Parus major Linnaeus, 1758',
      canonicalName: 'Parus major',
      rank: 'SPECIES',
      status: 'ACCEPTED',
      confidence: 99,
      matchType: 'EXACT',
      kingdom: 'Animalia',
      phylum: 'Chordata',
      class: 'Aves',
      order: 'Passeriformes',
      family: 'Paridae',
      genus: 'Parus',
      species: 'Parus major',
      kingdomKey: 1,
      phylumKey: 44,
      classKey: 212,
      orderKey: 729,
      familyKey: 9322,
      genusKey: 2492278,
      speciesKey: 5231190,
    });

    const ctx = createMockContext({ errors: gbifMatchSpecies.errors });
    const input = gbifMatchSpecies.input.parse({ name: 'Parus major' });
    const result = await gbifMatchSpecies.handler(input, ctx);

    expect(result.taxonKey).toBe(5231190);
    expect(result.scientificName).toBe('Parus major Linnaeus, 1758');
    expect(result.canonicalName).toBe('Parus major');
    expect(result.rank).toBe('SPECIES');
    expect(result.matchType).toBe('EXACT');
    expect(result.confidence).toBe(99);
    expect(result.kingdom).toBe('Animalia');
    expect(result.kingdomKey).toBe(1);
  });

  /**
   * #35 — fixture is the live /species/match response for "Felis leo": the accepted
   * taxon arrives only as acceptedUsageKey, with no accompanying accepted-name string.
   * Counting on the synonym's own key (7630906) returns 106 records against the accepted
   * taxon's 18,961, so taxonKey has to be the accepted one.
   */
  it('returns the accepted key as taxonKey when the queried name is a synonym', async () => {
    mockMatchSpecies.mockResolvedValue({
      usageKey: 7630906,
      acceptedUsageKey: 5219404,
      scientificName: 'Felis leo Linnaeus, 1758',
      canonicalName: 'Felis leo',
      rank: 'SPECIES',
      status: 'SYNONYM',
      confidence: 98,
      matchType: 'EXACT',
      species: 'Panthera leo',
      speciesKey: 5219404,
    });

    const ctx = createMockContext({ errors: gbifMatchSpecies.errors });
    const input = gbifMatchSpecies.input.parse({ name: 'Felis leo' });
    const result = await gbifMatchSpecies.handler(input, ctx);

    expect(result.taxonKey).toBe(5219404);
    expect(result.matchedTaxonKey).toBe(7630906);
    expect(result.status).toBe('SYNONYM');

    const notice = getEnrichment(ctx).notice;
    expect(notice).toContain('5219404');
    expect(notice).toContain('7630906');
    expect(notice).toContain('gbif_get_species');
  });

  /**
   * speciesKey is not a substitute for acceptedUsageKey — for Chrysanthemum leucanthemum
   * GBIF returns speciesKey 8848598 and acceptedUsageKey 7222149, two different taxa.
   */
  it('resolves to acceptedUsageKey rather than speciesKey', async () => {
    mockMatchSpecies.mockResolvedValue({
      usageKey: 3134125,
      acceptedUsageKey: 7222149,
      canonicalName: 'Chrysanthemum leucanthemum',
      status: 'SYNONYM',
      matchType: 'EXACT',
      species: 'Leucanthemum vulgare',
      speciesKey: 8848598,
    });

    const ctx = createMockContext({ errors: gbifMatchSpecies.errors });
    const input = gbifMatchSpecies.input.parse({ name: 'Chrysanthemum leucanthemum' });
    const result = await gbifMatchSpecies.handler(input, ctx);

    expect(result.taxonKey).toBe(7222149);
    expect(result.speciesKey).toBe(8848598);
  });

  it('leaves taxonKey alone and emits no notice on an accepted match', async () => {
    mockMatchSpecies.mockResolvedValue({
      usageKey: 5219404,
      canonicalName: 'Panthera leo',
      status: 'ACCEPTED',
      matchType: 'EXACT',
      confidence: 99,
    });

    const ctx = createMockContext({ errors: gbifMatchSpecies.errors });
    const input = gbifMatchSpecies.input.parse({ name: 'Panthera leo' });
    const result = await gbifMatchSpecies.handler(input, ctx);

    expect(result.taxonKey).toBe(5219404);
    expect(result.matchedTaxonKey).toBeUndefined();
    expect(getEnrichment(ctx).notice).toBeUndefined();
  });

  it('throws no_match when matchType is NONE', async () => {
    mockMatchSpecies.mockResolvedValue({ matchType: 'NONE', usageKey: undefined });

    const ctx = createMockContext({ errors: gbifMatchSpecies.errors });
    const input = gbifMatchSpecies.input.parse({ name: 'xyznonexistentspecies' });

    await expect(gbifMatchSpecies.handler(input, ctx)).rejects.toMatchObject({
      data: { reason: 'no_match' },
    });
  });

  it('throws no_match when usageKey is missing', async () => {
    mockMatchSpecies.mockResolvedValue({ matchType: 'FUZZY', usageKey: undefined });

    const ctx = createMockContext({ errors: gbifMatchSpecies.errors });
    const input = gbifMatchSpecies.input.parse({ name: 'incomplete result' });

    await expect(gbifMatchSpecies.handler(input, ctx)).rejects.toMatchObject({
      data: { reason: 'no_match' },
    });
  });

  it('passes optional kingdom and rank filters', async () => {
    mockMatchSpecies.mockResolvedValue({
      usageKey: 1234,
      matchType: 'EXACT',
      canonicalName: 'Rosa canina',
      scientificName: 'Rosa canina L.',
    });

    const ctx = createMockContext({ errors: gbifMatchSpecies.errors });
    const input = gbifMatchSpecies.input.parse({
      name: 'Rosa canina',
      kingdom: 'Plantae',
      rank: 'SPECIES',
    });
    const result = await gbifMatchSpecies.handler(input, ctx);

    expect(result.taxonKey).toBe(1234);
    expect(mockMatchSpecies).toHaveBeenCalledWith(
      expect.objectContaining({ kingdom: 'Plantae', rank: 'SPECIES' }),
      ctx,
    );
  });

  it('handles sparse upstream response', async () => {
    mockMatchSpecies.mockResolvedValue({
      usageKey: 9999,
      matchType: 'HIGHERRANK',
      canonicalName: 'Aves',
      // no classification keys, no confidence
    });

    const ctx = createMockContext({ errors: gbifMatchSpecies.errors });
    const input = gbifMatchSpecies.input.parse({ name: 'birds' });
    const result = await gbifMatchSpecies.handler(input, ctx);

    expect(result.taxonKey).toBe(9999);
    expect(result.confidence).toBeUndefined();
    expect(result.kingdomKey).toBeUndefined();
  });

  it('formats output with key fields', () => {
    const output = {
      taxonKey: 5231190,
      scientificName: 'Parus major Linnaeus, 1758',
      canonicalName: 'Parus major',
      rank: 'SPECIES',
      status: 'ACCEPTED',
      confidence: 99,
      matchType: 'EXACT',
      kingdom: 'Animalia',
      kingdomKey: 1,
    };
    const blocks = gbifMatchSpecies.format!(output);
    expect(blocks.some((b) => b.type === 'text')).toBe(true);
    const text = blocks[0].type === 'text' ? blocks[0].text : '';
    expect(text).toContain('5231190');
    expect(text).toContain('Parus major');
    expect(text).toContain('99');
    expect(text).toContain('EXACT');
    expect(text).toContain('Animalia');
  });

  it('renders both keys so content[]-only clients see the resolution', () => {
    const blocks = gbifMatchSpecies.format!({
      taxonKey: 5219404,
      matchedTaxonKey: 7630906,
      canonicalName: 'Felis leo',
      status: 'SYNONYM',
    });
    const text = blocks[0].type === 'text' ? blocks[0].text : '';

    expect(text).toContain('5219404');
    expect(text).toContain('7630906');
    expect(text).toMatch(/synonym/i);
  });

  it('formats sparse output without invented facts', () => {
    const blocks = gbifMatchSpecies.format!({});
    expect(blocks.some((b) => b.type === 'text')).toBe(true);
    const text = blocks[0].type === 'text' ? blocks[0].text : '';
    // No fabricated values for missing fields
    expect(text).not.toContain('undefined');
    expect(text).not.toContain('null');
  });
});
