/**
 * @fileoverview Search GBIF occurrence records with Darwin Core filters.
 * @module mcp-server/tools/definitions/gbif-search-occurrences
 */

import { tool, z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import { getGbifService } from '@/services/gbif/gbif-service.js';
import { IUCN_RED_LIST_CATEGORY_VALUES, OCCURRENCE_STATUS_VALUES } from '@/services/gbif/types.js';
import {
  isGbifUuid,
  occurrenceStatusNotice,
  overPaginationCapNotice,
  PAGINATION_CAP,
  stateProvinceNoMatchNotice,
} from '../utils.js';

/** Empty-result and pagination-overshoot guidance. */
function buildNotice(args: {
  totalCount: number;
  occurrenceCount: number;
  offset: number;
}): string | undefined {
  const { totalCount, occurrenceCount, offset } = args;
  if (totalCount === 0) {
    return 'No occurrences matched the filters. Try broadening the taxon (use gbif_match_species for a reliable taxonKey), relaxing geographic filters, expanding the year range, or removing basisOfRecord.';
  }
  if (occurrenceCount === 0 && offset > 0 && offset >= totalCount) {
    return `Offset ${offset} exceeds totalCount (${totalCount}). Reset offset to 0 or reduce it below ${totalCount} to page through results.`;
  }
  return;
}

export const gbifSearchOccurrences = tool('gbif_search_occurrences', {
  title: 'Search Occurrences',
  description:
    'Search 3.9B+ GBIF occurrence records with Darwin Core filters. Use taxonKey from gbif_match_species ' +
    'for reliable results — it resolves synonyms automatically. Accepts country (ISO 3166-1 alpha-2, where ' +
    "the record was observed), publishingCountry (the publishing organization's country — a different " +
    'question), stateProvince, bounding box (decimalLatitude/decimalLongitude ranges), WKT polygon ' +
    'geometry, year range, month, ' +
    'basis of record, coordinate filter, and dataset key. Returns sightings only by default — GBIF also ' +
    'indexes absence records (surveys that looked and found nothing), and occurrenceStatus controls ' +
    'whether they are included. Pagination is capped at offset+limit=100,001 and GBIF offers no ' +
    'cursor or scroll, so a larger result set is covered only by partitioning it — facet it by ' +
    'DATASET_KEY with gbif_occurrence_facets and search each datasetKey separately. This server ' +
    'cannot download a result set in bulk; that needs the GBIF Download API with a GBIF.org ' +
    'account, or the GBIF snapshot on AWS Open Data.',
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  input: z.object({
    taxonKey: z
      .number()
      .optional()
      .describe(
        'GBIF backbone taxon key from gbif_match_species. Preferred over scientificName — matches all synonyms automatically. Matches the given taxon and all descendant taxa (subspecies, varieties, etc.).',
      ),
    scientificName: z
      .string()
      .optional()
      .describe(
        'Scientific name filter. Less precise than taxonKey — does not match synonyms. Use taxonKey from gbif_match_species for reliable results. Supplying both does not narrow the search: GBIF combines the two taxon filters with OR, so the result is the union of the two, not their intersection.',
      ),
    country: z
      .string()
      .optional()
      .describe(
        'ISO 3166-1 alpha-2 code of where the occurrence was recorded (e.g., "GB", "US", "DE", "SE"). Not the publisher\'s country — that is publishingCountry, and the two disagree on most records.',
      ),
    publishingCountry: z
      .string()
      .regex(/^[A-Z]{2}$/)
      .optional()
      .describe(
        'ISO 3166-1 alpha-2 code, uppercase, of the organization that published the record — not where the occurrence was observed, which is country. The two differ constantly: of 60,290,950 records observed in GB, 1,548,928 were published by US organizations. Take a value from a PUBLISHING_COUNTRY facet on gbif_occurrence_facets. Lowercase and alpha-3 forms ("us", "USA") match nothing upstream, which is why only the uppercase two-letter form is accepted here.',
      ),
    stateProvince: z
      .string()
      .optional()
      .describe(
        'State, province, or first-level administrative division, matched as a verbatim string — exact and case-sensitive. GBIF stores what each dataset recorded without normalizing it, so there is no vocabulary to guess from: "England", "England - Greater London", and "Greater London" are three distinct values, and "england" is none of them. Take one from a STATE_PROVINCE facet on gbif_occurrence_facets scoped the same way and pass it back unchanged — an unmatched value returns zero records rather than an error. Records carrying no stateProvince match no value, so this cannot partition a scope.',
      ),
    decimalLatitude: z
      .string()
      .optional()
      .describe(
        'Latitude range as "min,max" (e.g., "47.0,48.5"). Decimal degrees, WGS84. Combine with decimalLongitude for a bounding box.',
      ),
    decimalLongitude: z
      .string()
      .optional()
      .describe(
        'Longitude range as "min,max" (e.g., "8.0,9.5"). Decimal degrees, WGS84. Combine with decimalLatitude for a bounding box.',
      ),
    geometry: z
      .string()
      .optional()
      .describe(
        'WKT polygon for geographic filtering (e.g., POLYGON((8 47, 9 47, 9 48, 8 48, 8 47))). Coordinates are longitude latitude. Takes precedence over decimalLatitude/decimalLongitude.',
      ),
    year: z
      .string()
      .optional()
      .describe(
        'Year or year range. Single year: "2024". Range: "2020,2024". Filters by observation year. Both endpoints inclusive.',
      ),
    month: z
      .number()
      .min(1)
      .max(12)
      .optional()
      .describe('Calendar month (1–12). Useful for seasonal distribution queries.'),
    basisOfRecord: z
      .enum([
        'HUMAN_OBSERVATION',
        'MACHINE_OBSERVATION',
        'PRESERVED_SPECIMEN',
        'LIVING_SPECIMEN',
        'MATERIAL_SAMPLE',
        'MATERIAL_CITATION',
        'OCCURRENCE',
        'LITERATURE',
      ])
      .optional()
      .describe(
        'Filter by how the occurrence was recorded. HUMAN_OBSERVATION covers citizen science. PRESERVED_SPECIMEN covers natural history collections.',
      ),
    hasCoordinate: z
      .boolean()
      .optional()
      .describe(
        'When true, return only georeferenced records (those with coordinates). When false, return ONLY records without coordinates. Omit the parameter entirely to include all records regardless of coordinate presence.',
      ),
    isInCluster: z
      .boolean()
      .optional()
      .describe(
        'Filter to records flagged as likely duplicates (true) or exclude them (false). Omit to include all. ' +
          'Note: GBIF does not expose a cluster identifier — only the membership flag. To de-duplicate, set ' +
          'isInCluster: false to exclude all clustered records.',
      ),
    coordinateUncertaintyInMeters: z
      .string()
      .optional()
      .describe(
        'Filter by coordinate uncertainty radius in meters. Range format: "min,max" (e.g., "0,1000" for sub-kilometer precision). Both endpoints inclusive.',
      ),
    datasetKey: z
      .string()
      .optional()
      .describe(
        'Restrict results to a single dataset by its GBIF dataset UUID (8-4-4-4-12 hex). Obtain one from gbif_search_datasets, gbif_get_dataset, a DATASET_KEY facet (gbif_occurrence_facets), or the datasetKey field on an occurrence record.',
      ),
    occurrenceStatus: z
      .enum(OCCURRENCE_STATUS_VALUES)
      .default('PRESENT')
      .describe(
        "Presence/absence filter. Defaults to PRESENT: an ABSENT record documents a survey that looked for the taxon and did not find it, so including one would read as a sighting of the opposite. Use ANY for both (GBIF's own default), or ABSENT for non-observations alone.",
      ),
    iucnRedListCategory: z
      .enum(IUCN_RED_LIST_CATEGORY_VALUES)
      .optional()
      .describe(
        'Restrict to records whose taxon carries this IUCN Red List category: CR Critically Endangered, EN Endangered, VU Vulnerable, NT Near Threatened, LC Least Concern, DD Data Deficient, EX Extinct, EW Extinct in the Wild, CD Conservation Dependent. Records with no category are excluded when this is set.',
      ),
    limit: z
      .number()
      .min(1)
      .max(300)
      .default(20)
      .describe('Number of records to return (default 20, max 300).'),
    offset: z
      .number()
      .min(0)
      .default(0)
      .describe(
        'Pagination offset. GBIF serves offset+limit up to 100,001 and rejects anything past it, with no cursor or scroll to continue from. To reach a result set larger than that, split it into per-datasetKey searches using a DATASET_KEY facet from gbif_occurrence_facets — gap-free and high-cardinality, unlike YEAR, which leaves undated records in no bucket — rather than paging deeper.',
      ),
  }),
  output: z.object({
    occurrences: z
      .array(
        z
          .object({
            key: z
              .number()
              .optional()
              .describe('GBIF occurrence key for gbif_get_occurrence chaining.'),
            taxonKey: z.number().optional().describe('Backbone taxon key.'),
            scientificName: z
              .string()
              .optional()
              .describe('Scientific name from occurrence record.'),
            canonicalName: z.string().optional().describe('Canonical name without authorship.'),
            rank: z.string().optional().describe('Taxonomic rank of the identified taxon.'),
            taxonomicStatus: z
              .string()
              .optional()
              .describe(
                'Status of the identification carried on this record — ACCEPTED, PROVISIONALLY_ACCEPTED, SYNONYM, DOUBTFUL, and so on. Says whether the occurrence was filed under an accepted name or a synonym. May be absent.',
              ),
            decimalLatitude: z
              .number()
              .optional()
              .describe('Latitude in decimal degrees (WGS84). May be absent.'),
            decimalLongitude: z
              .number()
              .optional()
              .describe('Longitude in decimal degrees (WGS84). May be absent.'),
            coordinateUncertaintyInMeters: z
              .number()
              .optional()
              .describe('Coordinate uncertainty radius in meters. May be absent.'),
            country: z.string().optional().describe('Country name. May be absent.'),
            countryCode: z
              .string()
              .optional()
              .describe('ISO 3166-1 alpha-2 country code. May be absent.'),
            stateProvince: z.string().optional().describe('State or province name. May be absent.'),
            locality: z.string().optional().describe('Locality description. May be absent.'),
            eventDate: z
              .string()
              .optional()
              .describe('Observation date as ISO 8601 string. May be absent.'),
            eventTime: z
              .string()
              .optional()
              .describe(
                'Time of day of the observation, with seconds and UTC offset (e.g. 20:15:00+01:00) — the offset eventDate omits when it carries a local time. May be absent.',
              ),
            year: z.number().optional().describe('Observation year. May be absent.'),
            month: z.number().optional().describe('Observation month (1–12). May be absent.'),
            day: z.number().optional().describe('Observation day. May be absent.'),
            basisOfRecord: z.string().optional().describe('How the occurrence was recorded.'),
            occurrenceStatus: z
              .string()
              .optional()
              .describe(
                'PRESENT when the record asserts the taxon was there, ABSENT when it documents a survey that looked and did not find it. An ABSENT record is not a sighting. May be absent.',
              ),
            iucnRedListCategory: z
              .string()
              .optional()
              .describe(
                'IUCN Red List category of the taxon — CR, EN, VU, NT, LC, DD, EX, EW, or CD. May be absent.',
              ),
            individualCount: z
              .number()
              .optional()
              .describe('Number of individuals. May be absent.'),
            datasetKey: z.string().optional().describe('UUID of the source dataset.'),
            datasetName: z
              .string()
              .optional()
              .describe('Name of the source dataset. May be absent.'),
            publishingCountry: z
              .string()
              .optional()
              .describe('Country code of the publishing organization.'),
            recordedBy: z.string().optional().describe('Collector name(s). May be absent.'),
            issues: z
              .array(z.string())
              .optional()
              .describe('GBIF data quality issue flags for this record.'),
          })
          .describe(
            'A single occurrence record with location, taxon, date, and provenance fields.',
          ),
      )
      .describe('Occurrence records matching the filters.'),
  }),

  // Pagination context and recovery guidance — reaches both structuredContent and content[].
  enrichment: {
    totalCount: z.number().describe('Total matching occurrences before pagination.'),
    offset: z.number().describe('Current pagination offset.'),
    limit: z.number().describe('Records returned in this page.'),
    endOfRecords: z.boolean().describe('True when there are no more results after this page.'),
    occurrenceStatus: z
      .string()
      .describe(
        'The presence/absence filter applied upstream — PRESENT, ABSENT, or ANY when no filter was sent. Says what totalCount and the returned records cover.',
      ),
    notice: z
      .string()
      .optional()
      .describe(
        'Guidance when results are empty, paging overshot, the match is larger than the pagination cap can reach, or a presence/absence filter narrowed the result. Absent only when none applies.',
      ),
  },

  errors: [
    {
      reason: 'pagination_cap_exceeded',
      code: JsonRpcErrorCode.ValidationError,
      when: 'offset + limit exceeds 100,001, the deepest page GBIF serves.',
      recovery:
        "Reduce offset or limit so their sum is at most 100,001; GBIF exposes no cursor or scroll, so no parameter continues past it. To cover a result set larger than the cap, partition it instead of paging deeper: call gbif_occurrence_facets with facet DATASET_KEY, repeating this search's filters (every occurrence carries exactly one datasetKey, so the buckets cover the scope with no gaps or overlap, and facetOffset pages through them), then re-run this search once per datasetKey. A bucket still over the cap cuts further on BASIS_OF_RECORD or PUBLISHING_COUNTRY — the only other dimensions whose buckets leave no record out, and both have a matching filter here (basisOfRecord, publishingCountry). Do not take YEAR as the first cut — records without a year fall outside every year bucket, and MONTH, STATE_PROVINCE, and SPECIES_KEY lose records the same way, stateProvince included even though this tool can filter on it. Either second cut can also return a single bucket inside one dataset, so compare any sub-split's sum against the bucket total before relying on it. gbif_occurrence_facets takes no scientificName, month, latitude/longitude range, coordinate, cluster, or coordinate-uncertainty filter, so re-apply any of those on each per-datasetKey search rather than expecting the buckets to reflect them. Bucket counts reconcile against the occurrenceStatus in force, PRESENT by default here. Retrieving the set in one piece is not possible through this server: the GBIF Download API requires a GBIF.org account, runs asynchronously, and returns a ZIP archive, and the monthly GBIF Parquet snapshot on AWS Open Data is a bulk dataset — both are routes for the caller to take directly.",
    },
    {
      reason: 'invalid_filter',
      code: JsonRpcErrorCode.InvalidParams,
      when: 'A filter value is unusable — a datasetKey that is not a UUID, or a WKT geometry or range GBIF rejects.',
      recovery:
        'The message names the rejected value. Correct that one filter: geometry is a closed WKT ring in longitude latitude order, ranges are "min,max", and datasetKey is a UUID from gbif_search_datasets.',
    },
  ],

  async handler(input, ctx) {
    ctx.log.info('Searching occurrences', {
      taxonKey: input.taxonKey,
      country: input.country,
      limit: input.limit,
      offset: input.offset,
    });

    if (input.offset + input.limit > PAGINATION_CAP) {
      throw ctx.fail(
        'pagination_cap_exceeded',
        `offset + limit (${input.offset + input.limit}) exceeds ${PAGINATION_CAP.toLocaleString('en-US')}, the deepest page GBIF serves. Reduce offset/limit, or partition the query by datasetKey and page each part separately.`,
        { ...ctx.recoveryFor('pagination_cap_exceeded') },
      );
    }

    if (input.datasetKey?.trim() && !isGbifUuid(input.datasetKey)) {
      throw ctx.fail(
        'invalid_filter',
        `datasetKey "${input.datasetKey}" is not a GBIF dataset UUID.`,
        { ...ctx.recoveryFor('invalid_filter') },
      );
    }

    const raw = await getGbifService().searchOccurrences(
      {
        ...(input.taxonKey !== undefined && { taxonKey: input.taxonKey }),
        ...(input.scientificName?.trim() && { scientificName: input.scientificName }),
        ...(input.country?.trim() && { country: input.country }),
        ...(input.publishingCountry && { publishingCountry: input.publishingCountry }),
        ...(input.stateProvince?.trim() && { stateProvince: input.stateProvince }),
        ...(input.decimalLatitude?.trim() && { decimalLatitude: input.decimalLatitude }),
        ...(input.decimalLongitude?.trim() && { decimalLongitude: input.decimalLongitude }),
        ...(input.geometry?.trim() && { geometry: input.geometry }),
        ...(input.year?.trim() && { year: input.year }),
        ...(input.month !== undefined && { month: input.month }),
        ...(input.basisOfRecord && { basisOfRecord: input.basisOfRecord }),
        ...(input.hasCoordinate !== undefined && { hasCoordinate: input.hasCoordinate }),
        ...(input.isInCluster !== undefined && { isInCluster: input.isInCluster }),
        ...(input.coordinateUncertaintyInMeters?.trim() && {
          coordinateUncertaintyInMeters: input.coordinateUncertaintyInMeters,
        }),
        ...(input.datasetKey?.trim() && { datasetKey: input.datasetKey }),
        ...(input.occurrenceStatus !== 'ANY' && { occurrenceStatus: input.occurrenceStatus }),
        ...(input.iucnRedListCategory && { iucnRedListCategory: input.iucnRedListCategory }),
        limit: input.limit,
        offset: input.offset,
      },
      ctx,
    );

    const occurrences = (raw.results ?? []).map((r) => ({
      key: r.key,
      taxonKey: r.taxonKey,
      scientificName: r.scientificName,
      canonicalName: r.canonicalName,
      rank: r.taxonRank,
      taxonomicStatus: r.taxonomicStatus,
      decimalLatitude: r.decimalLatitude,
      decimalLongitude: r.decimalLongitude,
      coordinateUncertaintyInMeters: r.coordinateUncertaintyInMeters,
      country: r.country,
      countryCode: r.countryCode,
      stateProvince: r.stateProvince,
      locality: r.locality,
      eventDate: r.eventDate,
      eventTime: r.eventTime,
      year: r.year,
      month: r.month,
      day: r.day,
      basisOfRecord: r.basisOfRecord,
      occurrenceStatus: r.occurrenceStatus,
      iucnRedListCategory: r.iucnRedListCategory,
      individualCount: r.individualCount,
      datasetKey: r.datasetKey,
      datasetName: r.datasetName,
      publishingCountry: r.publishingCountry,
      recordedBy: r.recordedBy,
      issues: r.issues?.length ? r.issues : undefined,
    }));

    const totalCount = raw.count ?? 0;
    const offset = raw.offset ?? input.offset;
    const limit = raw.limit ?? input.limit;
    const endOfRecords = raw.endOfRecords ?? true;

    ctx.enrich({
      totalCount,
      offset,
      limit,
      endOfRecords,
      occurrenceStatus: input.occurrenceStatus,
    });
    const notice = [
      buildNotice({ totalCount, occurrenceCount: occurrences.length, offset }),
      stateProvinceNoMatchNotice(input.stateProvince, totalCount),
      overPaginationCapNotice(totalCount),
      occurrenceStatusNotice(input.occurrenceStatus),
    ]
      .filter(Boolean)
      .join(' ');
    if (notice) ctx.enrich.notice(notice);

    return { occurrences };
  },

  format: (result) => {
    const lines: string[] = [`**Results:** ${result.occurrences.length}`];
    for (const occ of result.occurrences) {
      const canonical = occ.canonicalName ?? occ.scientificName ?? 'Unknown taxon';
      const sci =
        occ.scientificName && occ.scientificName !== canonical ? ` [${occ.scientificName}]` : '';
      lines.push(`\n## ${canonical}${sci}`);
      if (occ.key != null) lines.push(`**Occurrence key:** ${occ.key}`);
      if (occ.taxonKey != null) lines.push(`**Taxon key:** ${occ.taxonKey}`);
      if (occ.rank) lines.push(`**Rank:** ${occ.rank}`);
      if (occ.taxonomicStatus) lines.push(`**Taxonomic status:** ${occ.taxonomicStatus}`);
      if (occ.basisOfRecord) lines.push(`**Basis of record:** ${occ.basisOfRecord}`);
      /**
       * Rendered for every record that carries it, PRESENT included. An absence
       * is only distinguishable from a sighting if the status is on the record
       * itself — a `content[]`-only client has no other place to read it.
       */
      if (occ.occurrenceStatus) lines.push(`**Occurrence status:** ${occ.occurrenceStatus}`);
      if (occ.iucnRedListCategory)
        lines.push(`**IUCN Red List category:** ${occ.iucnRedListCategory}`);
      if (occ.eventDate) {
        lines.push(`**Date:** ${occ.eventDate}`);
      }
      if (occ.eventTime) lines.push(`**Time:** ${occ.eventTime}`);
      if (occ.year != null) lines.push(`**Year:** ${occ.year}`);
      if (occ.month != null) lines.push(`**Month:** ${occ.month}`);
      if (occ.day != null) lines.push(`**Day:** ${occ.day}`);
      if (occ.decimalLatitude != null && occ.decimalLongitude != null) {
        lines.push(
          `**Coordinates:** ${occ.decimalLatitude}, ${occ.decimalLongitude}${occ.coordinateUncertaintyInMeters != null ? ` (±${occ.coordinateUncertaintyInMeters}m)` : ''}`,
        );
      } else {
        lines.push('**Coordinates:** Not available');
      }
      const geo: string[] = [];
      if (occ.locality) geo.push(occ.locality);
      if (occ.stateProvince) geo.push(occ.stateProvince);
      if (occ.country) geo.push(occ.country);
      if (geo.length > 0)
        lines.push(
          `**Location:** ${geo.join(', ')}${occ.countryCode ? ` (${occ.countryCode})` : ''}`,
        );
      else if (occ.countryCode) lines.push(`**Country code:** ${occ.countryCode}`);
      if (occ.publishingCountry) lines.push(`**Publishing country:** ${occ.publishingCountry}`);
      if (occ.recordedBy) lines.push(`**Recorded by:** ${occ.recordedBy}`);
      if (occ.individualCount != null) lines.push(`**Count:** ${occ.individualCount}`);
      if (occ.datasetKey)
        lines.push(`**Dataset:** ${occ.datasetName ?? occ.datasetKey} (key: ${occ.datasetKey})`);
      if (occ.issues?.length) lines.push(`**Issues:** ${occ.issues.join(', ')}`);
    }
    return [{ type: 'text', text: lines.join('\n') }];
  },
});
