/**
 * @fileoverview Count GBIF occurrences matching a filter without fetching records.
 * @module mcp-server/tools/definitions/gbif-count-occurrences
 */

import { tool, z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import { getGbifService } from '@/services/gbif/gbif-service.js';
import { IUCN_RED_LIST_CATEGORY_VALUES, OCCURRENCE_STATUS_VALUES } from '@/services/gbif/types.js';
import { isGbifUuid, occurrenceStatusNotice } from '../utils.js';

export const gbifCountOccurrences = tool('gbif_count_occurrences', {
  title: 'Count Occurrences',
  description:
    'Count occurrences matching a taxon + location filter without fetching records. ' +
    'Use for quick totals ("how many Aves records in Sweden?") or before deciding whether ' +
    'to paginate a full search. Accepts taxonKey, country, isGeoreferenced, datasetKey, year, ' +
    'occurrenceStatus, and iucnRedListCategory. Counts sightings only by default, matching ' +
    'gbif_search_occurrences — GBIF also indexes absence records, and for some taxa they are ' +
    'the overwhelming majority.',
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  input: z.object({
    taxonKey: z
      .number()
      .optional()
      .describe(
        'GBIF backbone taxon key from gbif_match_species. Matches the given taxon and all descendant taxa (subspecies, varieties, etc.).',
      ),
    country: z.string().optional().describe('ISO 3166-1 alpha-2 country code (e.g., "GB", "US").'),
    isGeoreferenced: z
      .boolean()
      .optional()
      .describe(
        'When true, count only georeferenced records. When false, count only non-georeferenced records.',
      ),
    datasetKey: z
      .string()
      .optional()
      .describe(
        'Filter to a specific dataset UUID (8-4-4-4-12 hex) from gbif_search_datasets. The result is not the recordCount the dataset tools and the gbif://dataset/{datasetKey} resource report for the same key: that figure spans every occurrenceStatus, while this count applies occurrenceStatus below, PRESENT by default.',
      ),
    year: z
      .string()
      .optional()
      .describe('Year or year range (e.g., "2024" or "2020,2024"). Both endpoints inclusive.'),
    occurrenceStatus: z
      .enum(OCCURRENCE_STATUS_VALUES)
      .default('PRESENT')
      .describe(
        "Presence/absence filter. Defaults to PRESENT: an ABSENT record documents a survey that looked for the taxon and did not find it, so counting one inflates the total with the opposite of a sighting. Use ANY for both (GBIF's own default), or ABSENT for non-observations alone. Matches the gbif_search_occurrences default, so the two tools agree.",
      ),
    iucnRedListCategory: z
      .enum(IUCN_RED_LIST_CATEGORY_VALUES)
      .optional()
      .describe(
        'Count only records whose taxon carries this IUCN Red List category: CR Critically Endangered, EN Endangered, VU Vulnerable, NT Near Threatened, LC Least Concern, DD Data Deficient, EX Extinct, EW Extinct in the Wild, CD Conservation Dependent. Records with no category are excluded when this is set.',
      ),
  }),
  output: z.object({
    count: z.number().describe('Total occurrences matching the supplied filters.'),
  }),

  // States which presence/absence filter produced the count — reaches both surfaces.
  enrichment: {
    occurrenceStatus: z
      .string()
      .describe(
        'The presence/absence filter applied upstream — PRESENT, ABSENT, or ANY when no filter was sent. Says what the count covers.',
      ),
    notice: z
      .string()
      .optional()
      .describe(
        'Guidance when a presence/absence filter narrowed the count. Absent when occurrenceStatus is ANY.',
      ),
  },

  errors: [
    {
      reason: 'invalid_filter',
      code: JsonRpcErrorCode.InvalidParams,
      when: 'datasetKey is not a UUID, or GBIF rejected another filter value as malformed.',
      recovery:
        'Supply datasetKey as the 8-4-4-4-12 hex UUID gbif_search_datasets returns; year is a single year or a "min,max" range.',
    },
  ],

  async handler(input, ctx) {
    ctx.log.info('Counting occurrences', {
      taxonKey: input.taxonKey,
      country: input.country,
    });

    // Rejected locally so a typo fails with this tool's recovery hint instead of a
    // bare upstream 400 that costs a round trip and the retry budget.
    if (input.datasetKey?.trim() && !isGbifUuid(input.datasetKey)) {
      throw ctx.fail(
        'invalid_filter',
        `datasetKey "${input.datasetKey}" is not a GBIF dataset UUID.`,
        { ...ctx.recoveryFor('invalid_filter') },
      );
    }

    const count = await getGbifService().countOccurrences(
      {
        ...(input.taxonKey !== undefined && { taxonKey: input.taxonKey }),
        ...(input.country?.trim() && { country: input.country }),
        ...(input.isGeoreferenced !== undefined && { isGeoreferenced: input.isGeoreferenced }),
        ...(input.datasetKey?.trim() && { datasetKey: input.datasetKey }),
        ...(input.year?.trim() && { year: input.year }),
        ...(input.occurrenceStatus !== 'ANY' && { occurrenceStatus: input.occurrenceStatus }),
        ...(input.iucnRedListCategory && { iucnRedListCategory: input.iucnRedListCategory }),
      },
      ctx,
    );

    ctx.enrich({ occurrenceStatus: input.occurrenceStatus });
    const notice = occurrenceStatusNotice(input.occurrenceStatus);
    if (notice) ctx.enrich.notice(notice);

    return { count };
  },

  format: (result) => [{ type: 'text', text: `**Occurrence count:** ${result.count}` }],
});
