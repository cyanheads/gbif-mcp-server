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
    'Use the gbif_* tools to query species taxonomy, occurrences, datasets, and publishers via the GBIF API. Keyless — these endpoints need no credentials. Resolve any name with gbif_match_species first — it returns the backbone taxonKey the occurrence tools expect, resolving a synonym to its accepted taxon and reporting the matched synonym key alongside as matchedTaxonKey, unlike the raw scientificName filter. Countries use ISO 3166-1 alpha-2; datasets and publishers are keyed by UUID, occurrences by integer key. GBIF indexes absence records — a documented survey that looked for a taxon and did not find it — alongside sightings, so gbif_search_occurrences, gbif_count_occurrences, and gbif_occurrence_facets all default occurrenceStatus to PRESENT and report the applied filter in their enrichment; pass ANY to include absences, or ABSENT for absences alone. For some taxa absences dominate: an unfiltered count can run five orders of magnitude above the sightings it appears to report. The dataset recordCount on gbif_search_datasets, gbif_get_dataset, and the gbif://dataset/{datasetKey} resource is not filtered that way — it spans every occurrenceStatus, so it will exceed a gbif_count_occurrences total for the same datasetKey by design. Occurrence paging caps at offset+limit=100,001 — switch to gbif_occurrence_facets for larger aggregate analysis.',
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
