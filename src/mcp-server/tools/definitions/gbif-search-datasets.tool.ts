/**
 * @fileoverview Search GBIF datasets by keyword, type, or country.
 * @module mcp-server/tools/definitions/gbif-search-datasets
 */

import { tool, z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import { getGbifService } from '@/services/gbif/gbif-service.js';
import { isGbifUuid, stripHtml } from '../utils.js';

/** Empty-result and pagination-overshoot guidance. */
function buildNotice(args: {
  totalCount: number;
  datasetCount: number;
  offset: number;
}): string | undefined {
  const { totalCount, datasetCount, offset } = args;
  if (totalCount === 0) {
    return 'No datasets matched. Try a shorter keyword, remove the type or country filter, or omit hostingOrg.';
  }
  if (datasetCount === 0 && offset > 0 && offset >= totalCount) {
    return `Offset ${offset} exceeds totalCount (${totalCount}). Reset offset to 0 or reduce it below ${totalCount} to page through results.`;
  }
  return;
}

export const gbifSearchDatasets = tool('gbif_search_datasets', {
  title: 'Search Datasets',
  description:
    'Search GBIF datasets by keyword, type, publishing country (uppercase ISO 3166-1 alpha-2), ' +
    'or hosting organization. ' +
    'Returns dataset title, description, license, record count, and DOI. ' +
    'Use to find the source dataset behind a set of records, or to explore what data collections ' +
    'are available for a taxon, country, or organization.',
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  input: z.object({
    q: z.string().optional().describe('Free-text search across dataset title and description.'),
    type: z
      .enum(['OCCURRENCE', 'CHECKLIST', 'METADATA', 'SAMPLING_EVENT'])
      .optional()
      .describe(
        'Filter by dataset type. OCCURRENCE for observation records, CHECKLIST for species lists.',
      ),
    publishingCountry: z
      .string()
      .regex(
        /^[A-Z]{2}$/,
        'publishingCountry must be an uppercase ISO 3166-1 alpha-2 code such as GB, US, or SE. Lowercase ("gb"), alpha-3 ("GBR"), and country names ("Britain") match no datasets upstream.',
      )
      .optional()
      .describe(
        'ISO 3166-1 alpha-2 code, uppercase, of the organization that published the dataset (e.g., "GB", "US", "DE", "SE"). Lowercase and alpha-3 forms ("gb", "GBR") match nothing upstream, which is why only the uppercase two-letter form is accepted here — unlike the country filter on gbif_search_publishers, which resolves either form. Take a value from a PUBLISHING_COUNTRY facet on gbif_occurrence_facets; an uppercase pair GBIF does not assign ("XX") is rejected upstream by name.',
      ),
    hostingOrg: z
      .string()
      .optional()
      .describe(
        'UUID (8-4-4-4-12 hex) of the hosting organization. From gbif_search_publishers results.',
      ),
    limit: z
      .number()
      .min(1)
      .max(1000)
      .default(20)
      .describe('Number of datasets to return (default 20, max 1000).'),
    offset: z.number().min(0).default(0).describe('Pagination offset.'),
  }),
  output: z.object({
    datasets: z
      .array(
        z
          .object({
            key: z.string().optional().describe('Dataset UUID for gbif_get_dataset chaining.'),
            title: z.string().optional().describe('Dataset title.'),
            type: z.string().optional().describe('Dataset type (OCCURRENCE, CHECKLIST, etc.).'),
            description: z
              .string()
              .optional()
              .describe('Brief description, truncated to a 300-character preview. May be absent.'),
            descriptionTruncated: z
              .boolean()
              .optional()
              .describe(
                'True when the description was shortened to the 300-char preview; call gbif_get_dataset with this key for the full text. Omitted when the dataset has no description.',
              ),
            license: z.string().optional().describe('License identifier. May be absent.'),
            doi: z.string().optional().describe('DOI for citation. May be absent.'),
            publishingCountry: z.string().optional().describe('Country code of the publisher.'),
            recordCount: z
              .number()
              .optional()
              .describe(
                'Occurrence records GBIF has indexed for this dataset, spanning every occurrenceStatus: absence records — surveys that looked for a taxon and did not find it — are counted alongside sightings, and on some datasets they are the overwhelming majority. For the sightings-only figure, call gbif_count_occurrences with this key; it defaults to occurrenceStatus PRESENT, so the two figures are expected to differ rather than one being wrong.',
              ),
          })
          .describe('A GBIF dataset with key, title, type, license, and record count.'),
      )
      .describe('Matching datasets.'),
  }),

  // Pagination context and recovery guidance — reaches both structuredContent and content[].
  enrichment: {
    totalCount: z.number().describe('Total matching datasets before pagination.'),
    offset: z.number().describe('Current pagination offset.'),
    limit: z.number().describe('Datasets returned in this page.'),
    endOfRecords: z.boolean().describe('True when there are no more results after this page.'),
    notice: z
      .string()
      .optional()
      .describe(
        'Guidance when results are empty or paging overshot. Absent on successful result pages.',
      ),
  },

  errors: [
    {
      reason: 'invalid_filter',
      code: JsonRpcErrorCode.InvalidParams,
      when: 'hostingOrg is not a UUID, publishingCountry is a two-letter code GBIF does not assign, or GBIF rejected another filter value as malformed.',
      recovery:
        'Supply hostingOrg as the 8-4-4-4-12 hex UUID gbif_search_publishers returns in its key field — an organization name is not a key; publishingCountry is a code GBIF assigns, so take one from a PUBLISHING_COUNTRY facet on gbif_occurrence_facets.',
    },
  ],

  async handler(input, ctx) {
    ctx.log.info('Searching datasets', { q: input.q, type: input.type });
    if (input.hostingOrg?.trim() && !isGbifUuid(input.hostingOrg)) {
      throw ctx.fail(
        'invalid_filter',
        `hostingOrg "${input.hostingOrg}" is not a GBIF organization UUID.`,
        { ...ctx.recoveryFor('invalid_filter') },
      );
    }

    const raw = await getGbifService().searchDatasets(
      {
        ...(input.q?.trim() && { q: input.q }),
        ...(input.type && { type: input.type }),
        ...(input.publishingCountry && { publishingCountry: input.publishingCountry }),
        ...(input.hostingOrg?.trim() && { hostingOrg: input.hostingOrg }),
        limit: input.limit,
        offset: input.offset,
      },
      ctx,
    );

    const datasets = (raw.results ?? []).map((r) => {
      const stripped = r.description ? stripHtml(r.description) : undefined;
      return {
        key: r.key,
        title: r.title,
        type: r.type,
        description: stripped?.slice(0, 300),
        ...(stripped !== undefined && { descriptionTruncated: stripped.length > 300 }),
        license: r.license,
        doi: r.doi,
        publishingCountry: r.publishingCountry,
        recordCount: r.numRecords ?? r.recordCount,
      };
    });

    const totalCount = raw.count ?? 0;
    const offset = raw.offset ?? input.offset;
    const limit = raw.limit ?? input.limit;
    const endOfRecords = raw.endOfRecords ?? true;

    ctx.enrich({ totalCount, offset, limit, endOfRecords });
    const notice = buildNotice({ totalCount, datasetCount: datasets.length, offset });
    if (notice) ctx.enrich.notice(notice);

    return { datasets };
  },

  format: (result) => {
    const lines: string[] = [`**Results:** ${result.datasets.length}`];
    /**
     * Stated once per page rather than per row, and only when a figure is
     * actually rendered. A `content[]`-only client never reads the field's
     * description, so without this the per-dataset totals arrive unscoped.
     */
    if (result.datasets.some((ds) => ds.recordCount != null)) {
      lines.push(
        'Record counts span every occurrenceStatus, absences included. gbif_count_occurrences with a dataset key counts sightings only by default.',
      );
    }
    for (const ds of result.datasets) {
      lines.push(`\n## ${ds.title ?? 'Untitled dataset'}`);
      if (ds.key) lines.push(`**Key:** ${ds.key}`);
      if (ds.type) lines.push(`**Type:** ${ds.type}`);
      if (ds.license) lines.push(`**License:** ${ds.license}`);
      if (ds.doi) lines.push(`**DOI:** ${ds.doi}`);
      if (ds.publishingCountry) lines.push(`**Publishing country:** ${ds.publishingCountry}`);
      if (ds.recordCount != null) lines.push(`**Records:** ${ds.recordCount.toLocaleString()}`);
      if (ds.description)
        lines.push(
          ds.descriptionTruncated
            ? `${ds.description}… (description truncated — full text via \`gbif_get_dataset\`)`
            : ds.description,
        );
    }
    return [{ type: 'text', text: lines.join('\n') }];
  },
});
