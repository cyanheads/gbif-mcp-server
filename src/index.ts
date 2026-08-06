#!/usr/bin/env node
/**
 * @fileoverview gbif-biodiversity-mcp-server MCP server entry point.
 * @module index
 */

import { createApp } from '@cyanheads/mcp-ts-core';
import { getServerConfig } from './config/server-config.js';
// Resources
import { gbifDatasetResource } from './mcp-server/resources/definitions/gbif-dataset.resource.js';
import { gbifSpeciesResource } from './mcp-server/resources/definitions/gbif-species.resource.js';
import { gbifBulkMatchSpecies } from './mcp-server/tools/definitions/gbif-bulk-match-species.tool.js';
import { gbifCountOccurrences } from './mcp-server/tools/definitions/gbif-count-occurrences.tool.js';
import { gbifGetDataset } from './mcp-server/tools/definitions/gbif-get-dataset.tool.js';
import { gbifGetOccurrence } from './mcp-server/tools/definitions/gbif-get-occurrence.tool.js';
import { gbifGetSpecies } from './mcp-server/tools/definitions/gbif-get-species.tool.js';
import { gbifGetSpeciesChildren } from './mcp-server/tools/definitions/gbif-get-species-children.tool.js';
import { gbifGetSpeciesClassification } from './mcp-server/tools/definitions/gbif-get-species-classification.tool.js';
// Taxonomy tools
import { gbifMatchSpecies } from './mcp-server/tools/definitions/gbif-match-species.tool.js';
import { gbifOccurrenceFacets } from './mcp-server/tools/definitions/gbif-occurrence-facets.tool.js';
// Dataset and publisher tools
import { gbifSearchDatasets } from './mcp-server/tools/definitions/gbif-search-datasets.tool.js';
// Occurrence tools
import { gbifSearchOccurrences } from './mcp-server/tools/definitions/gbif-search-occurrences.tool.js';
import { gbifSearchPublishers } from './mcp-server/tools/definitions/gbif-search-publishers.tool.js';
import { gbifSearchSpecies } from './mcp-server/tools/definitions/gbif-search-species.tool.js';
import { initGbifService } from './services/gbif/gbif-service.js';

await createApp({
  name: 'gbif-biodiversity-mcp-server',
  title: 'gbif-biodiversity-mcp-server',
  instructions:
    'Use the gbif_* tools to query species taxonomy, occurrences, datasets, and publishers via the GBIF API. Keyless — these endpoints need no credentials. Resolve any name with gbif_match_species first — it returns the backbone taxonKey the occurrence tools expect, resolving a synonym to its accepted taxon and reporting the matched synonym key alongside as matchedTaxonKey, unlike the raw scientificName filter. Countries use ISO 3166-1 alpha-2; datasets and publishers are keyed by UUID, occurrences by integer key. On the occurrence tools country and publishingCountry, and on gbif_search_datasets publishingCountry, the uppercase two-letter form is the only one accepted — lowercase and alpha-3 forms ("gb", "USA") match nothing on those routes, so those fields reject anything else rather than answering zero, while gbif_search_publishers resolves either form case-insensitively against the registry and needs no such constraint. On the occurrence tools country is where the record was observed and publishingCountry is the country of the organization that published it — different questions that disagree on most records, so pick deliberately; stateProvince is matched verbatim, exactly and case-sensitively, and an unrecognized value returns zero records rather than an error, so take one from a STATE_PROVINCE facet instead of guessing a spelling. GBIF indexes absence records — a documented survey that looked for a taxon and did not find it — alongside sightings, so gbif_search_occurrences, gbif_count_occurrences, and gbif_occurrence_facets all default occurrenceStatus to PRESENT and report the applied filter in their enrichment; pass ANY to include absences, or ABSENT for absences alone. For some taxa absences dominate: an unfiltered count can run five orders of magnitude above the sightings it appears to report. The dataset recordCount on gbif_search_datasets, gbif_get_dataset, and the gbif://dataset/{datasetKey} resource is not filtered that way — it spans every occurrenceStatus, so it will exceed a gbif_count_occurrences total for the same datasetKey by design. Occurrence paging caps at offset+limit=100,001 and GBIF exposes no cursor or scroll, so a larger result set is reached only by partitioning it: gbif_occurrence_facets with facet DATASET_KEY splits a scope into buckets that sum to its full total, since every occurrence carries exactly one datasetKey, and each bucket is then searchable on its own; a facet on a dimension a record can lack — YEAR, MONTH, STATE_PROVINCE — leaves those records in no bucket, stateProvince included even though the occurrence tools can filter on it, while BASIS_OF_RECORD and PUBLISHING_COUNTRY are gap-free and both have a matching search filter, making either a sound second cut on a bucket still over the cap though too coarse for the first. Bucket sums reconcile only against the same occurrenceStatus, and only when the facet call repeats the search filters — gbif_occurrence_facets accepts a narrower set than gbif_search_occurrences and gbif_count_occurrences, so re-apply whatever it cannot take on each per-datasetKey search. This server cannot retrieve a result set in bulk — the GBIF Download API needs a GBIF.org account and returns an archive asynchronously, and the monthly GBIF Parquet snapshot on AWS Open Data is a bulk dataset; both are routes to take outside this server.',
  tools: [
    gbifMatchSpecies,
    gbifBulkMatchSpecies,
    gbifGetSpecies,
    gbifSearchSpecies,
    gbifGetSpeciesClassification,
    gbifGetSpeciesChildren,
    gbifSearchOccurrences,
    gbifCountOccurrences,
    gbifGetOccurrence,
    gbifOccurrenceFacets,
    gbifSearchDatasets,
    gbifGetDataset,
    gbifSearchPublishers,
  ],
  resources: [gbifSpeciesResource, gbifDatasetResource],
  prompts: [],
  // Public catalog — serve the full landing inventory regardless of auth mode.
  landing: { requireAuth: false },
  setup(core) {
    const cfg = getServerConfig();
    initGbifService(core.config, core.storage, {
      baseUrl: cfg.baseUrl,
      timeoutMs: cfg.requestTimeoutMs,
      userAgent: cfg.userAgent,
    });
  },
});
