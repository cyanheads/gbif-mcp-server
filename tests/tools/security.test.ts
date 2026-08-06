/**
 * @fileoverview Security tests — injection resistance, oversized inputs, and secret non-leakage.
 * @module tests/tools/security.test
 */

import { createMockContext } from '@cyanheads/mcp-ts-core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { gbifCountOccurrences } from '@/mcp-server/tools/definitions/gbif-count-occurrences.tool.js';
import { gbifGetDataset } from '@/mcp-server/tools/definitions/gbif-get-dataset.tool.js';
import { gbifGetOccurrence } from '@/mcp-server/tools/definitions/gbif-get-occurrence.tool.js';
import { gbifGetSpecies } from '@/mcp-server/tools/definitions/gbif-get-species.tool.js';
import { gbifMatchSpecies } from '@/mcp-server/tools/definitions/gbif-match-species.tool.js';
import { gbifOccurrenceFacets } from '@/mcp-server/tools/definitions/gbif-occurrence-facets.tool.js';
import { gbifSearchDatasets } from '@/mcp-server/tools/definitions/gbif-search-datasets.tool.js';
import { gbifSearchOccurrences } from '@/mcp-server/tools/definitions/gbif-search-occurrences.tool.js';
import { gbifSearchPublishers } from '@/mcp-server/tools/definitions/gbif-search-publishers.tool.js';
import { gbifSearchSpecies } from '@/mcp-server/tools/definitions/gbif-search-species.tool.js';

vi.mock('@/services/gbif/gbif-service.js', () => ({
  getGbifService: vi.fn(),
}));

import { getGbifService } from '@/services/gbif/gbif-service.js';

const INJECTION_STRINGS = [
  "<script>alert('xss')</script>",
  '"; DROP TABLE species; --',
  "' OR '1'='1",
  '../../../etc/passwd',
  '%00null',
  '\x00\x01\x02',
  '{{7*7}}',
  // biome-ignore lint/suspicious/noTemplateCurlyInString: intentional injection probe string
  '${7*7}',
  '‮ reverse',
];

const makeOccurrenceResponse = (overrides = {}) => ({
  results: [],
  count: 0,
  offset: 0,
  limit: 20,
  endOfRecords: true,
  ...overrides,
});

describe('Input injection — string parameters do not crash handlers', () => {
  const mockSearch = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getGbifService).mockReturnValue({
      searchOccurrences: mockSearch,
      searchSpecies: mockSearch,
      searchDatasets: mockSearch,
      searchPublishers: mockSearch,
      getOccurrenceFacets: vi.fn().mockResolvedValue({ count: 0, facets: [] }),
    } as never);
    mockSearch.mockResolvedValue(makeOccurrenceResponse());
  });

  for (const injection of INJECTION_STRINGS) {
    /**
     * gbif_search_occurrences takes no free-text `q` — Zod strips unknown keys, so
     * probing one would leave the injection string outside the parsed input and the
     * assertion would hold against any implementation. scientificName is the tool's
     * free-text field, so the string actually reaches the handler.
     */
    it(`gbif_search_occurrences survives scientificName="${injection.slice(0, 30)}"`, async () => {
      const ctx = createMockContext({ errors: gbifSearchOccurrences.errors });
      const input = gbifSearchOccurrences.input.parse({ scientificName: injection });
      expect(input.scientificName).toBe(injection);

      // Must not throw — the service mock returns empty results
      const result = await gbifSearchOccurrences.handler(input, ctx);
      expect(result.occurrences).toBeDefined();
      expect(mockSearch).toHaveBeenCalledWith(
        expect.objectContaining({ scientificName: injection }),
        ctx,
      );
    });

    it(`gbif_search_species survives q="${injection.slice(0, 30)}"`, async () => {
      const ctx = createMockContext();
      const input = gbifSearchSpecies.input.parse({ q: injection });
      const result = await gbifSearchSpecies.handler(input, ctx);
      expect(result.taxa).toBeDefined();
    });

    it(`gbif_search_datasets survives q="${injection.slice(0, 30)}"`, async () => {
      const ctx = createMockContext();
      const input = gbifSearchDatasets.input.parse({ q: injection });
      const result = await gbifSearchDatasets.handler(input, ctx);
      expect(result.datasets).toBeDefined();
    });

    it(`gbif_search_publishers survives q="${injection.slice(0, 30)}"`, async () => {
      const ctx = createMockContext();
      const input = gbifSearchPublishers.input.parse({ q: injection });
      const result = await gbifSearchPublishers.handler(input, ctx);
      expect(result.publishers).toBeDefined();
    });

    it(`gbif_match_species survives name="${injection.slice(0, 30)}"`, async () => {
      vi.mocked(getGbifService).mockReturnValue({
        matchSpecies: vi.fn().mockResolvedValue({ matchType: 'NONE', usageKey: undefined }),
      } as never);
      const ctx = createMockContext({ errors: gbifMatchSpecies.errors });
      const input = gbifMatchSpecies.input.parse({ name: injection });
      // NONE match throws no_match — that's the correct behavior, not a crash
      await expect(gbifMatchSpecies.handler(input, ctx)).rejects.toMatchObject({
        data: { reason: 'no_match' },
      });
    });
  }
});

describe('UUID-typed inputs reject before reaching GBIF', () => {
  const mockSearch = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getGbifService).mockReturnValue({
      searchOccurrences: mockSearch,
      searchSpecies: mockSearch,
      searchDatasets: mockSearch,
      countOccurrences: mockSearch,
      getDataset: mockSearch,
      getOccurrenceFacets: mockSearch,
    } as never);
  });

  const uuidInputs = [
    { name: 'gbif_search_occurrences.datasetKey', def: gbifSearchOccurrences, field: 'datasetKey' },
    { name: 'gbif_count_occurrences.datasetKey', def: gbifCountOccurrences, field: 'datasetKey' },
    { name: 'gbif_search_species.datasetKey', def: gbifSearchSpecies, field: 'datasetKey' },
    { name: 'gbif_search_datasets.hostingOrg', def: gbifSearchDatasets, field: 'hostingOrg' },
    { name: 'gbif_get_dataset.datasetKey', def: gbifGetDataset, field: 'datasetKey' },
    {
      name: 'gbif_occurrence_facets.datasetKey',
      def: gbifOccurrenceFacets,
      field: 'datasetKey',
      extra: { facet: 'COUNTRY' },
    },
  ] as const;

  for (const { name, def, field, extra } of uuidInputs.map((u) => ({
    extra: undefined as Record<string, unknown> | undefined,
    ...u,
  }))) {
    it(`${name} rejects an injection string as invalid_filter`, async () => {
      const ctx = createMockContext({ errors: def.errors });
      const input = def.input.parse({ ...extra, [field]: "' OR '1'='1" });

      const err = await def.handler(input as never, ctx).catch((e: unknown) => e);

      expect(err).toMatchObject({ data: { reason: 'invalid_filter' } });
      expect(mockSearch).not.toHaveBeenCalled();
    });

    /**
     * A padded key is forwarded verbatim, not trimmed, so accepting one would let a
     * caller-side defect reach GBIF unexamined — and `/occurrence/count`, which the
     * dataset record-count lookup still uses, answers 200 with `0` for a malformed
     * key rather than an error.
     */
    it(`${name} rejects a whitespace-padded UUID rather than forwarding it`, async () => {
      const ctx = createMockContext({ errors: def.errors });
      const padded = ' 4fa7b334-ce0d-4e88-aaae-2e0c138d049e ';
      const input = def.input.parse({ ...extra, [field]: padded });
      expect((input as Record<string, unknown>)[field]).toBe(padded);

      const err = await def.handler(input as never, ctx).catch((e: unknown) => e);

      expect(err).toMatchObject({ data: { reason: 'invalid_filter' } });
      expect(mockSearch).not.toHaveBeenCalled();
    });
  }
});

/**
 * The occurrence presence/absence and IUCN filters are closed vocabularies, and
 * GBIF treats a bad value in each differently: `occurrenceStatus` draws HTTP 400,
 * but `iucnRedListCategory` is answered with 200 and a count of zero. A string
 * that reaches either would therefore be a wrong answer rather than an error at
 * best, so the schema has to stop it before the handler runs.
 */
describe('Closed-vocabulary occurrence filters reject before the handler runs', () => {
  const enumInputs = [
    { name: 'gbif_search_occurrences', def: gbifSearchOccurrences, extra: {} },
    { name: 'gbif_count_occurrences', def: gbifCountOccurrences, extra: {} },
    { name: 'gbif_occurrence_facets', def: gbifOccurrenceFacets, extra: { facet: 'COUNTRY' } },
  ] as const;

  for (const { name, def, extra } of enumInputs) {
    for (const injection of INJECTION_STRINGS) {
      it(`${name}.occurrenceStatus rejects "${injection.slice(0, 24)}"`, () => {
        expect(() => def.input.parse({ ...extra, occurrenceStatus: injection })).toThrow();
      });

      it(`${name}.iucnRedListCategory rejects "${injection.slice(0, 24)}"`, () => {
        expect(() => def.input.parse({ ...extra, iucnRedListCategory: injection })).toThrow();
      });
    }

    /**
     * The enum is load-bearing only if the field is actually declared — an
     * undeclared key is stripped by Zod and every rejection assertion above would
     * hold against a tool that never had the filter.
     */
    it(`${name} declares both filters rather than silently stripping them`, () => {
      const parsed = def.input.parse({
        ...extra,
        occurrenceStatus: 'ABSENT',
        iucnRedListCategory: 'CR',
      }) as Record<string, unknown>;

      expect(parsed.occurrenceStatus).toBe('ABSENT');
      expect(parsed.iucnRedListCategory).toBe('CR');
    });
  }
});

/**
 * #49 — `publishingCountry` draws on the same closed ISO 3166-1 alpha-2 vocabulary,
 * but GBIF splits its rejections: an unparseable code answers HTTP 400 while a
 * lowercase or alpha-3 form answers 200 with zero records. The silent half is the
 * dangerous one, so the schema carries a `^[A-Z]{2}$` pattern and every non-code
 * string fails before the handler runs. `stateProvince` is deliberately absent from
 * this suite — it is free text by nature, guarded by a runtime notice instead.
 */
describe('publishingCountry rejects non-code strings before the handler runs', () => {
  const patternInputs = [
    { name: 'gbif_search_occurrences', def: gbifSearchOccurrences, extra: {} },
    { name: 'gbif_count_occurrences', def: gbifCountOccurrences, extra: {} },
    { name: 'gbif_occurrence_facets', def: gbifOccurrenceFacets, extra: { facet: 'COUNTRY' } },
  ] as const;

  for (const { name, def, extra } of patternInputs) {
    for (const injection of INJECTION_STRINGS) {
      it(`${name}.publishingCountry rejects "${injection.slice(0, 24)}"`, () => {
        expect(() => def.input.parse({ ...extra, publishingCountry: injection })).toThrow();
      });
    }

    /**
     * Declared, not stripped — without this an undeclared key would satisfy every
     * rejection assertion above on a tool that never had the filter at all.
     */
    it(`${name} declares publishingCountry and keeps a valid code`, () => {
      const parsed = def.input.parse({ ...extra, publishingCountry: 'US' }) as Record<
        string,
        unknown
      >;
      expect(parsed.publishingCountry).toBe('US');
    });
  }
});

describe('Oversized input handling', () => {
  const mockSearch = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getGbifService).mockReturnValue({
      searchOccurrences: mockSearch,
      searchSpecies: mockSearch,
      searchDatasets: mockSearch,
      searchPublishers: mockSearch,
    } as never);
    mockSearch.mockResolvedValue(makeOccurrenceResponse());
  });

  it('gbif_search_occurrences handles very long scientificName string', async () => {
    const ctx = createMockContext({ errors: gbifSearchOccurrences.errors });
    const input = gbifSearchOccurrences.input.parse({ scientificName: 'A'.repeat(5000) });
    expect(input.scientificName).toHaveLength(5000);

    const result = await gbifSearchOccurrences.handler(input, ctx);
    expect(result.occurrences).toBeDefined();
  });

  it('gbif_search_species handles very long q string', async () => {
    const ctx = createMockContext();
    const input = gbifSearchSpecies.input.parse({ q: 'B'.repeat(5000) });
    const result = await gbifSearchSpecies.handler(input, ctx);
    expect(result.taxa).toBeDefined();
  });

  it('gbif_occurrence_facets rejects facetLimit > 100', () => {
    expect(() => gbifOccurrenceFacets.input.parse({ facet: 'COUNTRY', facetLimit: 101 })).toThrow();
  });

  it('gbif_occurrence_facets rejects facetLimit < 1', () => {
    expect(() => gbifOccurrenceFacets.input.parse({ facet: 'COUNTRY', facetLimit: 0 })).toThrow();
  });

  it('gbif_search_occurrences rejects limit > 300', () => {
    expect(() => gbifSearchOccurrences.input.parse({ limit: 301 })).toThrow();
  });

  it('gbif_search_occurrences rejects limit < 1', () => {
    expect(() => gbifSearchOccurrences.input.parse({ limit: 0 })).toThrow();
  });

  it('gbif_search_species rejects limit > 1000', () => {
    expect(() => gbifSearchSpecies.input.parse({ limit: 1001 })).toThrow();
  });
});

describe('Required field validation', () => {
  it('gbif_get_occurrence requires occurrenceKey', () => {
    expect(() => gbifGetOccurrence.input.parse({})).toThrow();
  });

  it('gbif_get_species requires taxonKey', () => {
    expect(() => gbifGetSpecies.input.parse({})).toThrow();
  });

  it('gbif_get_dataset requires datasetKey', () => {
    expect(() => gbifGetDataset.input.parse({})).toThrow();
  });

  it('gbif_match_species requires name', () => {
    expect(() => gbifMatchSpecies.input.parse({})).toThrow();
  });

  it('gbif_occurrence_facets requires facet', () => {
    expect(() => gbifOccurrenceFacets.input.parse({})).toThrow();
  });

  it('gbif_occurrence_facets rejects invalid facet value', () => {
    expect(() => gbifOccurrenceFacets.input.parse({ facet: 'INVALID_DIMENSION' })).toThrow();
  });

  it('gbif_occurrence_facets rejects invalid basisOfRecord value', () => {
    expect(() =>
      gbifOccurrenceFacets.input.parse({ facet: 'COUNTRY', basisOfRecord: 'UNKNOWN_VALUE' }),
    ).toThrow();
  });

  it('gbif_search_datasets rejects invalid type value', () => {
    expect(() => gbifSearchDatasets.input.parse({ type: 'INVALID_TYPE' })).toThrow();
  });

  it('gbif_get_occurrence requires integer occurrenceKey', () => {
    expect(() => gbifGetOccurrence.input.parse({ occurrenceKey: 'abc' })).toThrow();
  });

  it('gbif_get_species requires integer taxonKey', () => {
    expect(() => gbifGetSpecies.input.parse({ taxonKey: 'abc' })).toThrow();
  });
});

describe('Secret non-leakage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /**
   * The handlers have no try/catch — an upstream failure propagates untouched
   * and the framework classifies and masks it. So the testable invariant is
   * identity: the thrown value is the service's own error, with nothing about
   * the request or environment attached on the way out. Asserting only that a
   * benign fixture message lacks credential-shaped text would pass against any
   * implementation.
   */
  it('gbif_count_occurrences propagates the upstream error without attaching config', async () => {
    const upstream = new Error('Service error from upstream');
    vi.mocked(getGbifService).mockReturnValue({
      countOccurrences: vi.fn().mockRejectedValue(upstream),
    } as never);

    const ctx = createMockContext();
    const input = gbifCountOccurrences.input.parse({ taxonKey: 1 });

    const err = await gbifCountOccurrences.handler(input, ctx).catch((e: unknown) => e);
    expect(err).toBe(upstream);
    expect(JSON.stringify({ message: (err as Error).message, ...(err as object) })).not.toMatch(
      /API_KEY|SECRET|PASSWORD|TOKEN/i,
    );
  });

  it('gbif_search_occurrences propagates the upstream error without appending env values', async () => {
    const upstream = new Error('Internal failure at /home/app/src');
    vi.mocked(getGbifService).mockReturnValue({
      searchOccurrences: vi.fn().mockRejectedValue(upstream),
    } as never);

    const ctx = createMockContext({ errors: gbifSearchOccurrences.errors });
    const input = gbifSearchOccurrences.input.parse({});

    const err = await gbifSearchOccurrences.handler(input, ctx).catch((e: unknown) => e);
    expect(err).toBe(upstream);
    expect((err as Error).message).toBe('Internal failure at /home/app/src');
  });
});
