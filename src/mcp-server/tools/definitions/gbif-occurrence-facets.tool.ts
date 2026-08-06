/**
 * @fileoverview Aggregate GBIF occurrence counts by a facet dimension.
 * @module mcp-server/tools/definitions/gbif-occurrence-facets
 */

import { tool, z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import { getGbifService } from '@/services/gbif/gbif-service.js';
import { IUCN_RED_LIST_CATEGORY_VALUES, OCCURRENCE_STATUS_VALUES } from '@/services/gbif/types.js';
import { isGbifUuid, occurrenceStatusNotice } from '../utils.js';

const BASIS_OF_RECORD_VALUES = [
  'HUMAN_OBSERVATION',
  'MACHINE_OBSERVATION',
  'PRESERVED_SPECIMEN',
  'LIVING_SPECIMEN',
  'MATERIAL_SAMPLE',
  'MATERIAL_CITATION',
  'OCCURRENCE',
  'LITERATURE',
] as const;

const FACET_VALUES = [
  'BASIS_OF_RECORD',
  'COUNTRY',
  'STATE_PROVINCE',
  'YEAR',
  'DATASET_KEY',
  'KINGDOM_KEY',
  'PHYLUM_KEY',
  'CLASS_KEY',
  'ORDER_KEY',
  'FAMILY_KEY',
  'GENUS_KEY',
  'SPECIES_KEY',
  'PUBLISHING_COUNTRY',
  'MONTH',
  'OCCURRENCE_STATUS',
  'IUCN_RED_LIST_CATEGORY',
] as const;

export const gbifOccurrenceFacets = tool('gbif_occurrence_facets', {
  title: 'Occurrence Facet Aggregation',
  description:
    'Aggregate occurrence counts across a dimension (COUNTRY, STATE_PROVINCE, YEAR, BASIS_OF_RECORD, DATASET_KEY, ' +
    'KINGDOM_KEY, etc.). Returns one page of facet values ranked by count descending — the top ' +
    'facetLimit at facetOffset 0, a later slice of the same ranking past that. No record payloads returned. ' +
    'Core tool for distribution analysis and trend queries: "which countries have the most records ' +
    'for this species?", "how has observation volume changed since 2010?". ' +
    'Scope the aggregation with taxonKey, country, year, geometry, basisOfRecord, datasetKey, ' +
    'occurrenceStatus, or iucnRedListCategory filters. Aggregates sightings only by default, ' +
    'matching gbif_search_occurrences and gbif_count_occurrences; to measure the presence/absence ' +
    'split itself, pass facet OCCURRENCE_STATUS with occurrenceStatus ANY.',
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  input: z.object({
    facet: z
      .enum(FACET_VALUES)
      .describe(
        'Dimension to aggregate by (e.g., COUNTRY, YEAR, BASIS_OF_RECORD, SPECIES_KEY, OCCURRENCE_STATUS, IUCN_RED_LIST_CATEGORY).',
      ),
    taxonKey: z
      .number()
      .optional()
      .describe(
        'Backbone taxon key to scope the aggregation. Matches the given taxon and all descendant taxa (subspecies, varieties, etc.).',
      ),
    country: z
      .string()
      .optional()
      .describe('ISO 3166-1 alpha-2 country code to scope to one country.'),
    year: z
      .string()
      .optional()
      .describe(
        'Year or year range (e.g., "2020,2024") to scope the aggregation. Both endpoints inclusive.',
      ),
    basisOfRecord: z
      .enum(BASIS_OF_RECORD_VALUES)
      .optional()
      .describe('Scope to a specific basis of record.'),
    geometry: z
      .string()
      .optional()
      .describe(
        'WKT polygon to scope the aggregation to a geographic area (e.g., POLYGON((8 47, 9 47, 9 48, 8 48, 8 47))). Coordinates are longitude latitude.',
      ),
    datasetKey: z
      .string()
      .optional()
      .describe(
        'Scope the aggregation to a single dataset by its GBIF dataset UUID (8-4-4-4-12 hex). Obtain one from gbif_search_datasets, gbif_get_dataset, a DATASET_KEY facet, or the datasetKey field on an occurrence record.',
      ),
    occurrenceStatus: z
      .enum(OCCURRENCE_STATUS_VALUES)
      .default('PRESENT')
      .describe(
        'Presence/absence scope. Defaults to PRESENT so the aggregation counts sightings, not the surveys that looked and found nothing, and agrees with gbif_count_occurrences on the same filters. Use ANY for both — required to see both buckets when facet is OCCURRENCE_STATUS — or ABSENT for non-observations alone.',
      ),
    iucnRedListCategory: z
      .enum(IUCN_RED_LIST_CATEGORY_VALUES)
      .optional()
      .describe(
        'Scope to records whose taxon carries this IUCN Red List category: CR Critically Endangered, EN Endangered, VU Vulnerable, NT Near Threatened, LC Least Concern, DD Data Deficient, EX Extinct, EW Extinct in the Wild, CD Conservation Dependent. Leave unset and facet on IUCN_RED_LIST_CATEGORY to see the whole distribution instead.',
      ),
    facetLimit: z
      .number()
      .min(1)
      .max(100)
      .default(10)
      .describe('Maximum number of facet values to return (default 10, max 100).'),
    facetOffset: z
      .number()
      .min(0)
      .default(0)
      .describe(
        'Zero-based offset into the ranked facet values, for paging past the first facetLimit values on high-cardinality dimensions like DATASET_KEY. Advance by facetLimit to fetch the next page (0, then facetLimit, then 2×facetLimit, …).',
      ),
  }),
  output: z.object({
    facet: z.string().describe('The facet dimension aggregated.'),
    totalOccurrences: z.number().describe('Total matching occurrences across all facet values.'),
    counts: z
      .array(
        z
          .object({
            name: z.string().describe('Facet value (country code, year, basisOfRecord, etc.).'),
            count: z.number().describe('Occurrence count for this facet value.'),
          })
          .describe('A facet value with its occurrence count.'),
      )
      .describe(
        'Facet values ranked by count descending — one page of up to facetLimit entries starting at facetOffset, not necessarily the top ones.',
      ),
  }),

  // Agent-facing context — reaches both structuredContent and content[].
  enrichment: {
    facetLimit: z.number().describe('Maximum facet values requested.'),
    facetOffset: z.number().describe('Zero-based offset applied to the ranked facet values.'),
    moreValuesLikely: z
      .boolean()
      .describe(
        'Heuristic continuation flag: true when this page returned a full facetLimit of values, so more distinct values may exist past facetOffset + facetLimit (re-call with facetOffset advanced by facetLimit). GBIF exposes no total distinct-value count, so this is an estimate, not exact.',
      ),
    occurrenceStatus: z
      .string()
      .describe(
        'The presence/absence filter applied upstream — PRESENT, ABSENT, or ANY when no filter was sent. Says what totalOccurrences and every bucket cover.',
      ),
    notice: z
      .string()
      .optional()
      .describe(
        'Guidance when no facet values were returned or a presence/absence filter narrowed the aggregation. Absent only when neither applies.',
      ),
  },

  errors: [
    {
      reason: 'invalid_filter',
      code: JsonRpcErrorCode.InvalidParams,
      when: 'datasetKey is not a UUID, or GBIF rejected the geometry or year scope as malformed.',
      recovery:
        'The message names the rejected value. Correct that one scope filter: geometry is a closed WKT ring in longitude latitude order, year is a single year or "min,max", and datasetKey is a UUID from gbif_search_datasets.',
    },
  ],

  async handler(input, ctx) {
    ctx.log.info('Fetching occurrence facets', { facet: input.facet, taxonKey: input.taxonKey });
    if (input.datasetKey?.trim() && !isGbifUuid(input.datasetKey)) {
      throw ctx.fail(
        'invalid_filter',
        `datasetKey "${input.datasetKey}" is not a GBIF dataset UUID.`,
        { ...ctx.recoveryFor('invalid_filter') },
      );
    }

    const raw = await getGbifService().getOccurrenceFacets(
      {
        facet: input.facet,
        ...(input.taxonKey !== undefined && { taxonKey: input.taxonKey }),
        ...(input.country?.trim() && { country: input.country }),
        ...(input.year?.trim() && { year: input.year }),
        ...(input.basisOfRecord && { basisOfRecord: input.basisOfRecord }),
        ...(input.geometry?.trim() && { geometry: input.geometry }),
        ...(input.datasetKey?.trim() && { datasetKey: input.datasetKey }),
        ...(input.occurrenceStatus !== 'ANY' && { occurrenceStatus: input.occurrenceStatus }),
        ...(input.iucnRedListCategory && { iucnRedListCategory: input.iucnRedListCategory }),
        facetLimit: input.facetLimit,
        facetOffset: input.facetOffset,
      },
      ctx,
    );

    const facetData = raw.facets?.find((f) => f.field?.toUpperCase() === input.facet.toUpperCase());
    const counts = (facetData?.counts ?? []).map((c) => ({
      name: c.name ?? '',
      count: c.count ?? 0,
    }));

    ctx.enrich({
      facetLimit: input.facetLimit,
      facetOffset: input.facetOffset,
      moreValuesLikely: counts.length >= input.facetLimit,
      occurrenceStatus: input.occurrenceStatus,
    });
    const notice = [
      counts.length === 0
        ? 'No facet values returned. The filter combination may match zero occurrences, or the facet dimension has no data for the given scope.'
        : undefined,
      occurrenceStatusNotice(input.occurrenceStatus),
    ]
      .filter(Boolean)
      .join(' ');
    if (notice) ctx.enrich.notice(notice);

    return {
      facet: input.facet,
      totalOccurrences: raw.count ?? 0,
      counts,
    };
  },

  format: (result) => {
    /**
     * The values rendered here are the top `facetLimit` only when `facetOffset` is 0 —
     * past that they are a later slice of the same ranking. `format()` receives `output`
     * alone, so the offset is not in scope; the header states what it can vouch for and
     * the facetOffset enrichment field below it fixes the page's position in the ranking.
     */
    const lines: string[] = [
      `## ${result.facet} Facet`,
      `**Total occurrences in scope:** ${result.totalOccurrences}`,
      result.counts.length === 0
        ? '**No facet values in this page.**'
        : `**Facet values in this page, ranked by count (${result.counts.length}, starting at facetOffset):**`,
    ];
    const total = result.totalOccurrences || 1;
    for (const entry of result.counts) {
      const pct = ((entry.count / total) * 100).toFixed(1);
      lines.push(`- **${entry.name}**: ${entry.count.toLocaleString()} (${pct}% of total)`);
    }
    return [{ type: 'text', text: lines.join('\n') }];
  },
});
