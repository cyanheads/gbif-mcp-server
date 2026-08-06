# gbif-biodiversity-mcp-server — Design

## MCP Surface

### Tools

| Name | Description | Key Inputs | Annotations |
|:-----|:------------|:-----------|:------------|
| `gbif_match_species` | Match a species name (scientific or common) against the GBIF backbone taxonomy. Returns the best-matching taxon with full classification and a confidence score. The starting point for any workflow involving a species name. | `name`, `strict`, `kingdom`, `rank` | `readOnlyHint: true` |
| `gbif_get_species` | Fetch a taxon record by GBIF taxon key — full classification, authorship, taxonomic status (accepted/synonym/doubtful), vernacular name, and descendant count. Use after `gbif_match_species` to get the full record for a backbone taxon key. | `taxonKey` | `readOnlyHint: true` |
| `gbif_search_species` | Search or browse the GBIF backbone taxonomy. Accepts scientific name fragments, rank filters, and higher-taxon constraints. Returns matching species/genera/families with taxonomy, vernacular names, and record counts. | `q`, `rank`, `kingdom`, `family`, `genus`, `isExtinct`, `limit`, `offset` | `readOnlyHint: true` |
| `gbif_get_species_classification` | Return the full parent chain from kingdom down to the given taxon — each rank as a named node with its own taxon key. Useful for building taxonomic trees or understanding placement without navigating the backbone level-by-level. | `taxonKey` | `readOnlyHint: true` |
| `gbif_get_species_children` | List direct children of a taxon in the GBIF backbone (e.g., species within a genus, genera within a family). Paginated. | `taxonKey`, `limit`, `offset` | `readOnlyHint: true` |
| `gbif_search_occurrences` | Search GBIF occurrence records. Primary workflow tool for location + taxon queries. Accepts taxon key (from `gbif_match_species`), country, bounding box, date range, basis of record, and other Darwin Core filters. Returns paginated occurrence records with coordinates, date, dataset, and collector. Filters to presences by default. | `taxonKey`, `scientificName`, `country`, `publishingCountry`, `stateProvince`, `decimalLatitude`, `decimalLongitude`, `geometry`, `year`, `month`, `basisOfRecord`, `hasCoordinate`, `occurrenceStatus`, `iucnRedListCategory`, `limit`, `offset` | `readOnlyHint: true` |
| `gbif_count_occurrences` | Count occurrences matching a taxon + location filter without fetching records. Use for quick totals ("how many Aves records in Sweden?") or before deciding whether to paginate a full search. Applies the same presence/absence default as `gbif_search_occurrences`. | `taxonKey`, `country`, `publishingCountry`, `stateProvince`, `isGeoreferenced`, `datasetKey`, `year`, `occurrenceStatus`, `iucnRedListCategory` | `readOnlyHint: true` |
| `gbif_get_occurrence` | Fetch a single occurrence record by GBIF occurrence key — full Darwin Core fields, coordinates, date, collector, media, dataset provenance. | `occurrenceKey` | `readOnlyHint: true` |
| `gbif_occurrence_facets` | Aggregate occurrence counts across a dimension (country, year, basis of record, dataset, kingdom). Returns one page of facet values ranked by count for a given filter — `facetLimit` entries starting at `facetOffset`. Core tool for distribution analysis and trend queries ("which countries have the most records for this species?", "how has observation volume changed since 2010?"). | `taxonKey`, `country`, `publishingCountry`, `stateProvince`, `geometry`, `facet`, `facetLimit`, `facetOffset`, `year`, `basisOfRecord`, `datasetKey`, `occurrenceStatus`, `iucnRedListCategory` | `readOnlyHint: true` |
| `gbif_search_datasets` | Search GBIF datasets by keyword, type, country, or publishing organization. Returns dataset title, description, license, record count, and DOI. | `q`, `type`, `publishingCountry`, `hostingOrg`, `limit`, `offset` | `readOnlyHint: true` |
| `gbif_get_dataset` | Fetch a dataset record by key — full metadata including title, description, citation, contacts, license, temporal/geographic coverage, and record count. | `datasetKey`, `contactLimit` | `readOnlyHint: true` |
| `gbif_search_publishers` | Search organizations (publishers/institutions) that contribute data to GBIF by name or country. Returns organization name, country, and key for chaining into dataset and occurrence queries. | `q`, `country`, `limit`, `offset` | `readOnlyHint: true` |

### Resources

| URI Template | Description | Pagination |
|:-------------|:------------|:-----------|
| `gbif://species/{taxonKey}` | Taxon record from the GBIF backbone — classification, authorship, synonymy status, vernacular name. Stable URI for caching and injection as context. | No |
| `gbif://dataset/{datasetKey}` | Dataset metadata — title, description, citation, license, contacts, coverage. Stable URI for provenance context. | No |

### Prompts

None for v1. The server's data surface is facts-and-records, not templated reasoning tasks. Users and agents reach for species identification and occurrence retrieval via tools.

---

## Overview

gbif-biodiversity-mcp-server exposes the Global Biodiversity Information Facility API (api.gbif.org/v1) as an MCP surface. GBIF aggregates 3.9 billion+ species occurrence records from natural history museums, citizen science platforms (eBird, iNaturalist), and research institutions worldwide. The backbone taxonomy covers all known species with hierarchical classification from kingdom through subspecies.

Primary users are ecologists, conservation biologists, environmental assessors, and researchers who need to query where a species has been observed, how observation volumes vary by geography or time, or what the accepted taxonomy is for a given name.

The server is read-only. Every endpoint it calls is public and takes no credentials — GBIF issues no API key.

---

## Requirements

- Search species by scientific name, common name, or name fragment against the GBIF backbone taxonomy
- Match a name (including misspellings or synonyms) to the accepted taxon and return its taxon key for downstream use
- Return full taxonomic classification chain (kingdom → phylum → class → order → family → genus → species)
- Browse taxonomy: children of a taxon, parent chain
- Search occurrences filtered by taxon key, country (ISO 3166-1 alpha-2), bounding box (lat/lon range or WKT polygon), date range, basis of record
- Count occurrences for a filter without returning records
- Fetch a single occurrence record by key with full Darwin Core fields
- Aggregate occurrence counts by facet (country, year, basis of record, dataset, kingdom)
- Search and fetch dataset metadata, including citation and license
- Search publishing organizations by name or country
- Communicate pagination state clearly — GBIF serves offset+limit up to 100,001 with no cursor or scroll; covering a larger result set means partitioning it by `datasetKey`, and retrieving one whole requires GBIF's account-only download API (out of scope)

---

## Services

| Service | Wraps | Used By |
|:--------|:------|:--------|
| `GbifService` | GBIF API v1 (`api.gbif.org/v1`) | All tools and resources |

One service handles all API communication. The GBIF REST API is a single base URL with clearly separated resource paths (`/species`, `/occurrence`, `/dataset`, `/organization`). No separate service per resource type.

---

## Config

| Env Var | Required | Description |
|:--------|:---------|:------------|
| `GBIF_BASE_URL` | No | Override the GBIF API base URL. Defaults to `https://api.gbif.org/v1`. |
| `GBIF_REQUEST_TIMEOUT_MS` | No | HTTP request timeout in milliseconds. Defaults to `10000`. |

---

## Implementation Order

1. Config — `src/config/server-config.ts` with base URL and request timeout
2. `GbifService` — base HTTP client, retry/backoff, response parsing, shared fetch utility
3. Taxonomy tools: `gbif_match_species`, `gbif_get_species`, `gbif_search_species`, `gbif_get_species_classification`, `gbif_get_species_children`
4. Occurrence tools: `gbif_search_occurrences`, `gbif_count_occurrences`, `gbif_get_occurrence`, `gbif_occurrence_facets`
5. Dataset + publisher tools: `gbif_search_datasets`, `gbif_get_dataset`, `gbif_search_publishers`
6. Resources: `gbif://species/{taxonKey}`, `gbif://dataset/{datasetKey}`

Each step is independently testable. Taxonomy tools (Step 3) have no dependency on occurrence tools; they can be developed and field-tested before moving to Step 4.

---

## Domain Mapping

Nouns and the operations the API exposes, mapped to tools:

| Noun | Operations | Tools |
|:-----|:-----------|:------|
| Species (backbone taxon) | match by name, get by key, search/browse, list children, get parent chain | `gbif_match_species`, `gbif_get_species`, `gbif_search_species`, `gbif_get_species_children`, `gbif_get_species_classification` |
| Occurrence record | search (by taxon/location/date), count, get by key, aggregate by facet | `gbif_search_occurrences`, `gbif_count_occurrences`, `gbif_get_occurrence`, `gbif_occurrence_facets` |
| Dataset | search, get by key | `gbif_search_datasets`, `gbif_get_dataset` |
| Publisher (organization) | search | `gbif_search_publishers` |
| Vernacular names | list for taxon | included in `gbif_get_species` and `gbif_search_species` output |
| Synonyms | check status for taxon | included in `gbif_get_species` output (`taxonomicStatus` + `acceptedKey`/`accepted` when synonym) |

Operations left out:

- Species distribution maps (image tiles, not useful to LLMs)
- Occurrence downloads (asynchronous job-based download API — requires a GBIF.org account, returns DwC archives; see decision 3)
- Literature/references per taxon (sparse data, low agent utility)
- GBIF node (country participant node) browsing (no agent use case)
- Name parser (`/parser/name`) — name matching via `gbif_match_species` covers the practical use case

---

## Tool Detail

### `gbif_match_species`

The entry point for any species workflow. Resolves a name string (scientific or vernacular) against the GBIF taxonomic backbone and returns the best-matching accepted taxon. Critically, it returns the backbone `usageKey` (exposed by the handler as `taxonKey`) that other tools (`gbif_search_occurrences`, `gbif_count_occurrences`, `gbif_occurrence_facets`) accept directly.

**Input schema:**

```ts
z.object({
  name: z.string()
    .describe('Scientific or common name to match. Examples: "Parus major", "Great Tit", "Homo sapiens". Fuzzy matching handles minor typos.'),
  strict: z.boolean().default(false)
    .describe('When true, only return an exact match. When false (default), GBIF applies fuzzy matching — useful for misspellings and vernacular names. Set to true when you need a confirmed scientific name match.'),
  kingdom: z.string().optional()
    .describe('Narrow the match to a specific kingdom (e.g., "Animalia", "Plantae", "Fungi") to disambiguate names that appear in multiple kingdoms.'),
  rank: z.enum(['KINGDOM','PHYLUM','CLASS','ORDER','FAMILY','GENUS','SPECIES','SUBSPECIES']).optional()
    .describe('Expected taxonomic rank. Use to avoid matching a genus when you expect a species.'),
})
```

**Output:**

- `usageKey` (number | null) — the raw field from the API: the key of the name that matched, which for a synonym is the synonym's own key. Null when no match.
- `acceptedUsageKey` (number) — present only on a synonym match. The endpoint carries no accepted-*name* string, so this key is everything it says about the accepted taxon; a name requires a follow-up `gbif_get_species` call.
- The handler emits `taxonKey` = `acceptedUsageKey ?? usageKey`, plus `matchedTaxonKey` = `usageKey` when the two differ, so the key handed downstream is always the one the occurrence tools should filter on.
- `scientificName` — full name with authority
- `canonicalName` — name without authority
- `rank`, `status` (ACCEPTED | SYNONYM | DOUBTFUL)
- `confidence` (0–100) — GBIF's match confidence; below 80 warrants user review
- `matchType` (EXACT | FUZZY | HIGHERRANK | NONE)
- Classification fields are returned **flat at the top level** (not nested): `kingdom`, `phylum`, `class`, `order`, `family`, `genus`, `species` and corresponding `kingdomKey`, `phylumKey`, `classKey`, `orderKey`, `familyKey`, `genusKey`, `speciesKey` fields. There is no nested `classification` object.
- Note: `alternatives` is **not returned** by the `/species/match` endpoint — it is absent from real API responses regardless of match quality.

**Errors:**

- `no_match` — `matchType === 'NONE'`, no candidate met threshold. Recovery: try a broader name or remove the `strict` flag.

**Annotations:** `readOnlyHint: true`, `openWorldHint: false`

---

### `gbif_get_species`

Fetch a single backbone taxon by key. Companion to `gbif_match_species` — call this when you need the full record (authorship, descendant count, synonymy status, vernacular name, publication reference) rather than just the classification summary that `gbif_match_species` returns.

**Input:** `taxonKey: z.number()`

**Output:**

- Full species record: `key`, `scientificName`, `canonicalName`, `authorship`, `rank`, `taxonomicStatus`, `kingdom`/`phylum`/`class`/`order`/`family`/`genus`/`species` + `*Key` fields
- `vernacularName` — English common name if present (may be absent)
- `numDescendants` — count of child taxa in backbone
- `taxonomicStatus` — `ACCEPTED`, `SYNONYM`, `DOUBTFUL`, etc. When `SYNONYM`, `acceptedKey` (number) and `accepted` (accepted name string) are also present. Note: there is no `synonym: boolean` field — use `taxonomicStatus === 'SYNONYM'` instead.
- `publishedIn` — original description citation if populated (may be absent)
- `extinct: boolean` — present only on taxa explicitly flagged as extinct; absent (not false) on most records

**Errors:** `not_found` when the taxonKey doesn't exist in the backbone.

**Annotations:** `readOnlyHint: true`, `openWorldHint: false`

---

### `gbif_search_species`

Browses or searches the backbone taxonomy. The primary tool for exploring what species exist under a higher taxon — e.g., "list all families of Coleoptera" or "find all Quercus species in the backbone". Also handles simple name-fragment searches when `gbif_match_species` returns too narrow a result.

**Key inputs:** `q` (name fragment), `rank`, `kingdom`, `family`, `genus`, `isExtinct`, `datasetKey` (to scope to a specific checklist), `limit` (default 20, max 1000), `offset`

**Output:** paginated list of taxon records, each with classification, vernacular name, `numOccurrences` count, and backbone key.

**Annotations:** `readOnlyHint: true`

---

### `gbif_get_species_classification`

Returns the complete parent chain for a taxon — from kingdom (or domain) down to the taxon itself — as an ordered array. Each entry has its rank, canonical name, and taxon key. Avoids requiring callers to navigate the hierarchy one level at a time.

The GBIF API exposes `/species/{taxonKey}/parents` which returns the full ancestor array. The result is already ordered root-first (kingdom → phylum → class → … → parent of the given taxon). No reversal is needed — the handler returns the array as-is.

**Input:** `taxonKey: z.number()`

**Output:** `classification: Array<{ rank, name, key }>` ordered root → leaf

**Annotations:** `readOnlyHint: true`, `openWorldHint: false`

---

### `gbif_get_species_children`

Lists direct children of a backbone taxon — genera within a family, species within a genus, subspecies within a species. Paginated.

**Key inputs:** `taxonKey`, `limit` (default 20), `offset`

**Output:** paginated list of child taxon records with rank, canonical name, key, and synonym status.

**Annotations:** `readOnlyHint: true`

---

### `gbif_search_occurrences`

The core data retrieval tool. Searches 3.9B+ occurrence records with Darwin Core filters. Supports taxon key, country (ISO 3166-1 alpha-2 code), publishing country, state/province, bounding box (decimalLatitude/decimalLongitude range or WKT polygon via `geometry`), year range, month, basis of record, and georeference filter.

**Important nuances:**
- `taxonKey` is the backbone key from `gbif_match_species`. Passing a raw name as `scientificName` also works but may miss synonyms — the backbone key is preferred. GBIF ORs the two rather than intersecting them, so passing both widens the result set instead of narrowing it (`taxonKey=212` alone and `taxonKey=212&scientificName=Puma concolor` differ by exactly the *Puma concolor* total).
- The occurrence search endpoint does NOT support free-text search against collectors or locality descriptions — use Darwin Core filter params.
- Pagination is capped: GBIF serves offset+limit up to 100,001 and answers `Max offset of 100001 exceeded` past it. There is no cursor, scroll, or search-after to continue from — and the endpoint ignores unrecognized parameter names with a 200, so probing for one returns the unchanged first page rather than an error. A result set larger than the cap is covered by partitioning on `datasetKey` (see decision 3), not by paging.
- WKT geometry accepts POLYGON and MULTIPOLYGON with coordinates as `lon lat` pairs.
- GBIF returns absence records by default. `occurrenceStatus` defaults to `PRESENT` here instead; `ANY` restores GBIF's behavior, and the applied value is reported in the enrichment either way.
- `/occurrence/search` silently ignores parameter names it does not recognize, answering 200 with the unfiltered total. A misspelled filter is a wrong answer, not an error.
- `country` and `publishingCountry` are different questions — where the record was observed versus the country of the organization that published it — and they disagree on most records (of 60,290,950 records observed in GB, 1,548,928 were published by US organizations). Both descriptions name the other, and the server `instructions` do too; see decision 13.
- `stateProvince` is verbatim, exact, and case-sensitive, with no controlled vocabulary — `England` matches 47,672,439 records on one scope while `england` and `ENGLAND` each match none, and an unmatched value answers 200 with zero records rather than an error. Constrained where it can be (`publishingCountry` carries a `^[A-Z]{2}$` pattern) and announced where it cannot (an empty result under a `stateProvince` filter carries a notice naming the semantics); see decision 13.

**Key inputs:**

```ts
z.object({
  taxonKey: z.number().optional()
    .describe('GBIF backbone taxon key from gbif_match_species. Preferred over scientificName — matches all synonyms automatically.'),
  scientificName: z.string().optional()
    .describe('Scientific name filter. Less precise than taxonKey — does not match synonyms. Use taxonKey from gbif_match_species for reliable results.'),
  country: z.string().optional()
    .describe('ISO 3166-1 alpha-2 code of where the occurrence was recorded (e.g., "GB", "US", "DE", "SE"). Not the publisher\'s country — that is publishingCountry.'),
  publishingCountry: z.string().regex(/^[A-Z]{2}$/).optional()
    .describe('ISO 3166-1 alpha-2 code, uppercase, of the organization that published the record — not where it was observed. Lowercase and alpha-3 forms match nothing upstream, hence the pattern.'),
  stateProvince: z.string().optional()
    .describe('State, province, or first-level administrative division, matched verbatim — exact and case-sensitive. Take a value from a STATE_PROVINCE facet; an unmatched value returns zero records rather than an error.'),
  decimalLatitude: z.string().optional()
    .describe('Latitude range as "min,max" (e.g., "47.0,48.5"). Decimal degrees, WGS84. Combine with decimalLongitude for a bounding box.'),
  decimalLongitude: z.string().optional()
    .describe('Longitude range as "min,max" (e.g., "8.0,9.5"). Decimal degrees, WGS84. Combine with decimalLatitude for a bounding box.'),
  geometry: z.string().optional()
    .describe('WKT polygon for geographic filtering (e.g., POLYGON((8 47, 9 47, 9 48, 8 48, 8 47))). Coordinates are longitude latitude. Takes precedence over decimalLatitude/decimalLongitude when both are supplied.'),
  year: z.string().optional()
    .describe('Year or year range. Single year: "2024". Range: "2020,2024". Filters by observation year.'),
  month: z.number().min(1).max(12).optional()
    .describe('Calendar month (1–12). Useful for seasonal distribution queries.'),
  basisOfRecord: z.enum(['HUMAN_OBSERVATION','MACHINE_OBSERVATION','PRESERVED_SPECIMEN','LIVING_SPECIMEN','MATERIAL_SAMPLE','MATERIAL_CITATION','OCCURRENCE','LITERATURE']).optional()
    .describe('Filter by how the occurrence was recorded. HUMAN_OBSERVATION covers citizen science (eBird, iNaturalist). PRESERVED_SPECIMEN covers natural history collections.'),
  hasCoordinate: z.boolean().optional()
    .describe('When true, return only georeferenced records (those with coordinates). When false, return ONLY records without coordinates. Omit the parameter entirely to include all records regardless of coordinate presence.'),
  isInCluster: z.boolean().optional()
    .describe('Filter to records flagged as likely duplicates (true) or exclude them (false). Omit to include all.'),
  datasetKey: z.string().optional()
    .describe('Restrict results to a single dataset by its GBIF dataset UUID.'),
  limit: z.number().min(1).max(300).default(20)
    .describe('Number of records to return (default 20, max 300).'),
  offset: z.number().min(0).default(0)
    .describe('Pagination offset. GBIF serves offset+limit up to 100,001 and rejects anything past it, with no cursor or scroll to continue from — to reach a larger result set, split it into per-datasetKey searches using a DATASET_KEY facet from gbif_occurrence_facets.'),
})
```

**Output per record (normalized):**

- `key` — occurrence key for `gbif_get_occurrence` chaining
- `taxonKey`, `scientificName`, `canonicalName`, `rank`
- `decimalLatitude`, `decimalLongitude`, `coordinateUncertaintyInMeters` (may be absent)
- `country`, `countryCode`, `stateProvince`, `locality` (may be absent)
- `taxonomicStatus` — whether the record was filed under an accepted name or a synonym
- `eventDate`, `eventTime` (time of day with UTC offset), `year`, `month`, `day`
- `basisOfRecord`, `occurrenceStatus`, `iucnRedListCategory`, `individualCount`
- `datasetKey`, `datasetName`, `publishingCountry`
- `recordedBy` (may be absent)
- `issues` — array of GBIF quality flags

**Pagination output:** `count` (total matches), `endOfRecords`, `offset`, `limit`, the applied `occurrenceStatus`, and an enrichment `notice` when the result set is empty, the offset overshot the total, or a presence/absence filter narrowed the result.

**Errors:** `pagination_cap_exceeded` when offset+limit passes 100,001, `invalid_filter` when a datasetKey is not a UUID or GBIF rejects the geometry or a range.

**Annotations:** `readOnlyHint: true`

---

### `gbif_count_occurrences`

Returns a single integer count, read from `/occurrence/search` at `limit=0` — no record payload, and the same filter set the search tool accepts. Use before `gbif_search_occurrences` when you only need the total, or to get counts for multiple filters in parallel.

**Key inputs:** `taxonKey`, `country`, `publishingCountry`, `stateProvince`, `isGeoreferenced`, `datasetKey`, `year`, `occurrenceStatus`, `iucnRedListCategory`

**Output:** `count: number`, plus enrichment carrying the applied `occurrenceStatus` and a `notice` when it narrowed the count, when the count is past what paging can reach, or when a verbatim `stateProvince` filter matched nothing.

**Annotations:** `readOnlyHint: true`, `openWorldHint: false`

---

### `gbif_get_occurrence`

Fetches a full occurrence record by its GBIF key. Returns the complete Darwin Core record — all coordinates, administrative geography (GADM), dates, collections metadata, collector identifiers, media links, and quality issue flags.

**Input:** `occurrenceKey: z.number()`

**Output:** Full record with normalized key fields plus `gadm` (GADM administrative divisions, levels 0–3), `taxonomicStatus`, `eventTime`, `occurrenceStatus`, `iucnRedListCategory`, `media` array, and `issues` array.

**Errors:** `not_found` when the key doesn't exist.

**Annotations:** `readOnlyHint: true`, `openWorldHint: false`

---

### `gbif_occurrence_facets`

Returns aggregated occurrence counts for a given facet dimension. Backed by the occurrence search endpoint with `limit=0` and `facet=<field>`, so it returns only the facet counts with no record payload — efficient for distribution analysis.

Available facet dimensions: `BASIS_OF_RECORD`, `COUNTRY`, `STATE_PROVINCE`, `YEAR`, `DATASET_KEY`, `KINGDOM_KEY`, `PHYLUM_KEY`, `CLASS_KEY`, `ORDER_KEY`, `FAMILY_KEY`, `GENUS_KEY`, `SPECIES_KEY`, `PUBLISHING_COUNTRY`, `MONTH`, `OCCURRENCE_STATUS`, `IUCN_RED_LIST_CATEGORY`.

**Key inputs:**

```ts
z.object({
  taxonKey: z.number().optional().describe('Backbone taxon key to scope the aggregation.'),
  country: z.string().optional().describe('ISO country code of where the occurrence was recorded, to scope to one country.'),
  publishingCountry: z.string().regex(/^[A-Z]{2}$/).optional().describe('ISO 3166-1 alpha-2 code, uppercase, of the publishing organization — pass back a PUBLISHING_COUNTRY bucket to drill into it.'),
  stateProvince: z.string().optional().describe('Verbatim state/province, exact and case-sensitive — pass back a STATE_PROVINCE bucket rather than guessing.'),
  year: z.string().optional().describe('Year or year range (e.g., "2020,2024").'),
  basisOfRecord: z.enum([...]).optional().describe('Scope to a specific basis of record.'),
  geometry: z.string().optional().describe('WKT polygon to scope the aggregation to a geographic area (e.g., POLYGON((8 47, 9 47, 9 48, 8 48, 8 47))). Coordinates are longitude latitude. Same format as gbif_search_occurrences.'),
  datasetKey: z.string().optional().describe('Scope the aggregation to a single dataset by its GBIF dataset UUID.'),
  occurrenceStatus: z.enum(['PRESENT','ABSENT','ANY']).default('PRESENT').describe('Presence/absence scope. ANY omits the filter upstream.'),
  iucnRedListCategory: z.enum(['CR','EN','VU','NT','LC','DD','EX','EW','CD']).optional().describe('Scope to one IUCN Red List category.'),
  facet: z.enum(['BASIS_OF_RECORD','COUNTRY','STATE_PROVINCE','YEAR','DATASET_KEY','KINGDOM_KEY','PHYLUM_KEY','CLASS_KEY','ORDER_KEY','FAMILY_KEY','GENUS_KEY','SPECIES_KEY','PUBLISHING_COUNTRY','MONTH','OCCURRENCE_STATUS','IUCN_RED_LIST_CATEGORY']).describe('Dimension to aggregate by.'),
  facetLimit: z.number().min(1).max(100).default(10).describe('Maximum number of facet values to return (default 10, max 100).'),
})
```

**Output:**

```ts
z.object({
  facet: z.string().describe('The facet dimension aggregated.'),
  totalOccurrences: z.number().describe('Total matching occurrences across all facet values.'),
  counts: z.array(z.object({
    name: z.string().describe('Facet value (e.g., country code, year, basisOfRecord). Note: the API returns this field as "name", not "value".'),
    count: z.number().describe('Occurrence count for this value.'),
  })).describe('Facet values ranked by count descending.'),
})
```

**Annotations:** `readOnlyHint: true`, `openWorldHint: false`

---

### `gbif_search_datasets`

Searches GBIF datasets. Useful for locating the specific dataset behind a set of records, or understanding what data collections are available for a country or taxonomic group.

**Key inputs:** `q` (free text), `type` (OCCURRENCE | CHECKLIST | METADATA | SAMPLING_EVENT), `publishingCountry`, `hostingOrg` (organization UUID), `limit` (default 20), `offset`

**Output per dataset:** `key`, `title`, `type`, `recordCount`, `publishingCountry`, `license`, `doi`, brief `description`. `recordCount` is GBIF's own indexed occurrence total and spans every `occurrenceStatus` — see decision 12.

**Annotations:** `readOnlyHint: true`

---

### `gbif_get_dataset`

Full dataset metadata including title, description, citation text, contacts, license, DOI, `numConstituents`, and temporal coverage. Use after `gbif_search_datasets` or when an occurrence record's `datasetKey` needs provenance detail.

**Input:** `datasetKey: z.string().uuid()`, `contactLimit` (default 10, max 100; `0` suppresses contact detail while still reporting the count)

**Output:** Full dataset record. `citation.text` is the citable reference. Contacts are capped at `contactLimit`, with `contactsTotal`/`contactsReturned` reporting the full count. `recordCount` is fetched separately — the detail endpoint omits it — and spans every `occurrenceStatus`, matching `gbif_search_datasets` rather than `gbif_count_occurrences`; see decision 12.

**Errors:** `not_found` when the UUID doesn't match any dataset.

**Annotations:** `readOnlyHint: true`, `openWorldHint: false`

---

### `gbif_search_publishers`

Searches organizations registered with GBIF by name fragment or country. Returns organization key, title, and country — sufficient to chain into `gbif_search_datasets` with `hostingOrg` or to understand who publishes data for a region.

**Key inputs:** `q`, `country`, `limit`, `offset`

**Output:** paginated list of `{ key, title, country, city }` per organization.

**Annotations:** `readOnlyHint: true`

---

## Workflow Analysis

### Workflow 1: Species distribution query

Typical agent task: "Where has *Dactylorhiza majalis* (marsh orchid) been observed in the British Isles?"

| # | Tool | Call |
|:--|:-----|:-----|
| 1 | `gbif_match_species` | `{ name: "Dactylorhiza majalis" }` → `taxonKey: 2839086` |
| 2 | `gbif_count_occurrences` | `{ taxonKey: 2839086, country: "GB" }` → total count for framing |
| 3 | `gbif_search_occurrences` | `{ taxonKey: 2839086, country: "GB", hasCoordinate: true, limit: 50 }` → paginated records |

Steps 2 and 3 are independent and can be called in parallel after step 1.

---

### Workflow 2: Taxonomic tree navigation

Typical agent task: "What families are in the order Coleoptera (beetles)?"

| # | Tool | Call |
|:--|:-----|:-----|
| 1 | `gbif_match_species` | `{ name: "Coleoptera", rank: "ORDER" }` → `taxonKey: 809` |
| 2 | `gbif_get_species_children` | `{ taxonKey: 809, limit: 100 }` → families |

For large orders with hundreds of families, iterate with offset.

---

### Workflow 3: Dataset provenance

Typical agent task: "This occurrence came from dataset `4fa7b334-...` — what's the citation?"

| # | Tool | Call |
|:--|:-----|:-----|
| 1 | `gbif_get_dataset` | `{ datasetKey: "4fa7b334-ce0d-4e88-aaae-2e0c138d049e" }` → full metadata with `citation.text` |

---

### Workflow 4: Temporal trend analysis

Typical agent task: "How has the number of *Parus major* observation records changed over the past 10 years?"

| # | Tool | Call |
|:--|:-----|:-----|
| 1 | `gbif_match_species` | `{ name: "Parus major" }` → `taxonKey: 9705453` |
| 2 | `gbif_occurrence_facets` | `{ taxonKey: 9705453, facet: "YEAR", facetLimit: 15, year: "2015,2025" }` → year × count breakdown |

---

### Workflow 5: Environmental impact assessment — species list for a site

Typical agent task: "What vertebrate species have been recorded in a 50km radius of a proposed development site at 51.5°N, -2.1°E?"

| # | Tool | Call |
|:--|:-----|:-----|
| 1 | `gbif_search_occurrences` | `{ geometry: "POLYGON(...)", basisOfRecord: "HUMAN_OBSERVATION", hasCoordinate: true, limit: 300 }` → records in area |
| 2 | `gbif_occurrence_facets` | `{ geometry: "...", facet: "SPECIES_KEY", facetLimit: 100 }` → species richness summary |

---

## Design Decisions

**1. `gbif_match_species` as the mandatory first step for species workflows.** The backbone taxon key is the stable identifier across GBIF's APIs — it handles synonymy, aggregates records across checklist sources, and is the primary parameter for occurrence search. Designing `gbif_match_species` as the explicit first step (rather than accepting scientific name strings everywhere) makes the two-step pattern visible and encourages correct use. The `scientificName` convenience parameter on `gbif_search_occurrences` exists for cases where the user knows they have an accepted name, but its limitations are documented.

**2. `gbif_occurrence_facets` as a separate tool, not folded into `gbif_search_occurrences`.** Facet-only queries (`limit=0`) are a fundamentally different use pattern — no records returned, just aggregate counts. Exposing them as a separate tool makes the intent clear and avoids the cognitive overhead of understanding `limit=0` as a special mode. The tool names the facet dimensions explicitly via an enum, which is more discoverable than a free string parameter.

**3. No complete-retrieval path past the pagination cap, and the guidance says so.** `/occurrence/search` has no cursor, scroll, or search-after — `offset`/`limit` under 100,001 is its entire pagination surface, and it answers 200 while ignoring parameter names it does not recognize, so a probe for a continuation token looks like a success and returns the first page again. Three routes past the cap exist, and none can live in this server:

- **The Download API** (`POST /occurrence/download/request`) answers `403 Access is denied` unauthenticated. It authenticates with HTTP Basic against a GBIF.org username and password — there is no API-key mode — then queues a job the caller polls until `SUCCEEDED` and collects as a ZIP. Proxying it would mean one shared account's credentials, quota, and notification inbox serving every tenant of a keyless multi-tenant server, and the job/poll/archive shape has no synchronous MCP equivalent. The archive can hold tens of millions of rows, which no agent context can read regardless of transport.
- **The AWS Open Data snapshot** (`gbif-open-data-us-east-1`, keyless) is a monthly Parquet dump for DuckDB or Spark — a bulk analytical dataset, not a live filtered query.
- **Caller-side partitioning** is the only route that works through this surface, and `datasetKey` is the dimension for it: every occurrence carries exactly one, so `DATASET_KEY` facet buckets cover the scope with no gap and no overlap, and the dimension has the cardinality to cut a large scope into pageable pieces. Measured on `taxonKey=212` + `country=GB` + `occurrenceStatus=PRESENT` (60,290,950 records): 550 `DATASET_KEY` buckets summing to 60,290,950 exactly, against 224 `YEAR` buckets summing to 59,407,400 — 883,550 undated records in no bucket. `basisOfRecord` and `publishingCountry` are gap-free as well (both sum to the whole 3.9-billion-record index exactly, in 9 and 250 buckets; 9 and 41 within the measured scope, where `PUBLISHING_COUNTRY` buckets summed to the scope total with no gap), and both have a matching filter on all three occurrence tools, so either drives a further split of a bucket still over the cap — but at that cardinality neither reaches pageable pieces as a first cut. Partitioning does not close the gap on its own either: 29 of the 550 buckets individually exceed the cap, and splitting the largest (`4fa7b334-ce0d-4e88-aaae-2e0c138d049e`, 42,437,187 records) by year leaves 41 of its 165 sub-buckets still over. Recursion depth is data-dependent and unbounded, so this is a technique for the caller to apply, not a bounded tool call.

The technique also depends on the facet call reproducing the query's scope, and `gbif_occurrence_facets` accepts a narrower filter set than `gbif_search_occurrences` (no `scientificName`, `month`, bounding box, `hasCoordinate`, `isInCluster`, or `coordinateUncertaintyInMeters`) or `gbif_count_occurrences` (no `isGeoreferenced`). The buckets partition the facet call's own scope either way; they only add up to the caller's total when both calls carry the same filters, so anything the facet tool cannot take has to be re-applied on each per-`datasetKey` search. Every surface carrying the guidance says so.

What ships instead is accurate guidance: the `pagination_cap_exceeded` recovery, the partition note on the `facet` description, an over-cap notice on `gbif_search_occurrences` and `gbif_count_occurrences`, and the server `instructions` all name the partition technique and state plainly that a bulk download is a route the caller takes outside this server.

**4. Occurrence record output normalization.** GBIF's occurrence search response is verbose (the `classifications` object includes entries for both the Catalogue of Life backbone and the legacy GBIF backbone, with deeply nested structure). The handler extracts the simpler top-level Darwin Core fields (`taxonKey`, `scientificName`, `kingdom`, etc.) and discards the `classifications` nested object to reduce response size. The full record is available via `gbif_get_occurrence` when needed.

**5. WKT geometry vs. lat/lon bounding box.** GBIF's occurrence search supports both. The design exposes both — `decimalLatitude`/`decimalLongitude` ranges for simple bounding boxes, `geometry` for WKT polygons. The `geometry` parameter is more powerful (supports non-rectangular areas, e.g., watershed boundaries) but harder to construct. Both are documented; the simpler lat/lon form is named first.

**6. No `gbif_get_species_synonyms` tool.** The synonyms endpoint (`/species/{key}/synonyms`) returns a paginated list of species records that are synonyms of the given accepted taxon. This is niche — most workflows need only to know whether a taxon *is* a synonym (surfaced in `gbif_get_species`), not to enumerate all synonyms of an accepted name. Deferred to a future iteration if demand warrants.

**7. Two resources, not more.** Species and dataset records are the two stable, addressable, reference objects with real utility as injectable context. Occurrence records are too numerous (3.9B+) and too transient to be useful as resources. Publisher/organization records are rarely needed as injectable context. The resource surface is intentionally minimal.

**8. Pagination cap enforced before the request.** GBIF rejects offset+limit past 100,001 with a deterministic 400, which would otherwise burn the whole retry budget. The handler checks the sum first and fails with `pagination_cap_exceeded`, naming the boundary and the partition technique from decision 3.

**9. Presence/absence filtering defaults to `PRESENT` across every occurrence query tool.** A GBIF `ABSENT` record documents a survey that looked for a taxon and did not find it, yet it arrives with coordinates, a date, and a recorder — indistinguishable from a sighting. GBIF returns both by default, and for absence-heavy taxa the mix dominates: *Radicipes gracilis* (`taxonKey` 2263005) has 2,351,582 indexed records, 79 of them presences. `gbif_search_occurrences`, `gbif_count_occurrences`, and `gbif_occurrence_facets` therefore all default to `PRESENT` so they answer the question a caller actually asked and agree with each other on the same filters. The default is never silent: each tool reports the applied `occurrenceStatus` in its enrichment and emits a notice naming the opt-out. `ANY` is a server-side sentinel, not a GBIF term — it resolves to an omitted parameter, since GBIF's vocabulary is only `PRESENT` and `ABSENT` and rejects anything else with a 400.

**10. `gbif_count_occurrences` reads its total from `/occurrence/search?limit=0`, not `/occurrence/count`.** The dedicated count endpoint accepts a closed parameter set and answers `Invalid parameter name` for both `occurrenceStatus` and `iucnRedListCategory`, so decision 9 is unreachable through it and the count tool would contradict the search tool on the same question. The two report the same total, and where they diverge `/occurrence/count` is the stale side: its responses are edge-cached at `max-age=600` and served well past it, so an entry hours old trails the search figure by a few thousand records and matches exactly once it refreshes. Search is also self-consistent, its own `OCCURRENCE_STATUS` facet counts summing to its total. One parameter does not carry over: `/occurrence/search` has no `isGeoreferenced` and silently ignores it rather than rejecting it, so the service maps it to `hasCoordinate`, which returns identical figures in both directions. `/occurrence/count` is still used for the supplementary dataset record count, where no such filter applies.

**11. IUCN Red List categories are a closed enum of the nine GBIF actually indexes.** GBIF answers an unrecognized `iucnRedListCategory` with HTTP 200 and a count of zero rather than an error, so an unvalidated string produces a confident empty result. The enum is taken from an unscoped `facet=IUCN_RED_LIST_CATEGORY` over the whole index: `CR`, `EN`, `VU`, `NT`, `LC`, `DD`, `EX`, `EW`, `CD`. `NE` (Not Evaluated) is deliberately excluded — it matches no record, so offering it would only produce that silent zero.

**12. Dataset `recordCount` stays unfiltered and says so, rather than being narrowed to match decision 9.** It is GBIF's own figure for its own dataset — `/dataset/search` publishes it, and re-scoping it to presences would make `gbif_get_dataset` and the `gbif://dataset/{datasetKey}` resource disagree with both `gbif_search_datasets` and gbif.org, trading one inconsistency for a worse one. Surfacing a second presence-scoped figure alongside it is no better: `gbif_search_datasets` returns up to 1,000 datasets per page and cannot afford a per-dataset count call, so only the detail surfaces could carry it and the list surface would be the odd one out. What was actually missing is the scope label. Every surface carrying the figure — both dataset tools, the resource, and the server `instructions` — now states that it spans every `occurrenceStatus` and names `gbif_count_occurrences` as the presence-scoped alternative, in the field description *and* in the rendered `content[]` text, since a `content[]`-only client never reads an output schema. The gap is not hypothetical: dataset `b6b4502f-ffc8-4048-a91b-af502288faa8` reports 30,622,351 records against 61,357 presences, a factor of 499.

The same pass dropped the `type === 'OCCURRENCE'` condition on the supplementary lookup. `/dataset/search` reports `recordCount` for all four dataset types, and `SAMPLING_EVENT` and `METADATA` datasets carry indexed occurrences in the tens of millions — including that same `b6b4502f` dataset, a `SAMPLING_EVENT`. Gating on `type` left the detail surfaces silent on exactly the datasets the list surface counts, which contradicted their own claim to match it; a `CHECKLIST` now resolves to 0, which is what search reports for it.

**13. `publishingCountry` and `stateProvince` are filters on all three occurrence tools, guarded differently because their vocabularies differ.** `gbif_occurrence_facets` offered `PUBLISHING_COUNTRY` and `STATE_PROVINCE` as dimensions while no occurrence tool could filter on either, so those buckets were a dead end — a caller could read that England holds 47,672,439 of a scope's records and had no way to fetch them. Every other dimension in the enum already had a matching filter. Both go on all three tools rather than one: adding a filter to `gbif_search_occurrences` alone would recreate the search/count/facets disagreement decision 9 exists to prevent. `/occurrence/search` backs all three, so one verification covers them — measured on `taxonKey=212` + `country=GB` + `occurrenceStatus=PRESENT` (60,290,950 records), `publishingCountry=US` gives 1,548,928 and `stateProvince=England` gives 47,672,439, with the facet call's bucket sums tracking the narrowed total in each case.

The guards differ because the failure modes do. `publishingCountry` draws on a closed vocabulary, and GBIF splits its rejections: an unparseable code (`XX`) answers HTTP 400, but a lowercase or alpha-3 form (`us`, `USA`) answers 200 with zero records — a silent wrong answer of exactly the shape decision 11 removed for `iucnRedListCategory`. A `^[A-Z]{2}$` pattern on the Zod schema turns every silent case into a local validation error, and lands in the JSON Schema a model reads from `tools/list` rather than in prose it may skip. `stateProvince` has no vocabulary to validate against — GBIF stores whatever each dataset recorded, unnormalized, so `England`, `England - Greater London`, and `Greater London` are three distinct values, matching is exact and case-sensitive (`england` and `ENGLAND` each return zero), and no pattern can separate a typo from a real value. Its guard is therefore a runtime notice: an empty result under a `stateProvince` filter says the match is verbatim and case-sensitive and points at the `STATE_PROVINCE` facet for the exact strings, which is what lets a caller tell a misspelling from a region that genuinely holds nothing. Every description also names the sibling field, because `country` (where the record was observed) and `publishingCountry` (the publisher's country) are easy to conflate and disagree on most records.

`publishingCountry` additionally repairs a gap decision 3 had to work around: `PUBLISHING_COUNTRY` is gap-free but was undrillable, so it could not serve as a second split axis. It can now. `stateProvince` does not gain that role — it stays lossy, so it partitions nothing.

The pre-existing `country` filter has the same silent-zero behavior (`country=gb` answers 200 with zero records) and is deliberately left unpatterned here: tightening an already-published parameter changes an existing tool's contract, which is a separate change from adding new ones. Tracked as its own issue.

---

## Known Limitations

- **Pagination hard cap at offset+limit 100,001, with no complete-retrieval path here.** GBIF's search API supports no cursor or scroll, so records past that offset are unreachable through this server. Covering a larger result set means partitioning it on `datasetKey` and paging each part, which is exhaustive but data-dependent in depth; retrieving it in one piece means GBIF's account-only download API or the AWS Open Data snapshot, both outside this server. See decision 3.
- **Occurrence search is not full-text.** The search endpoint filters on Darwin Core structured fields only. There is no free-text search across collector notes, locality descriptions, or identification remarks.
- **Backbone vs. checklist taxon keys.** GBIF has a single backbone taxonomy (`d7dddbf4-2cf0-4f39-9b2a-bb099caae36c`) and many secondary checklists. Occurrence search works only with backbone keys (the `nubKey`). The `gbif_match_species` tool always returns backbone keys.
- **Name matching confidence.** Below confidence ~80, matches should be treated with caution. The `confidence` field is surfaced in the output. The `/species/match` endpoint does not return an `alternatives` array — callers with low-confidence matches should retry with broader or different input (e.g., remove `strict`, try a higher-rank name).
- **Occurrence record sparsity.** Many fields in Darwin Core are optional. Coordinates, collector name, collection code, and locality may be absent, especially in older or museum-digitized records. Output schemas reflect this — most fields are optional.
- **Rate limiting is load-based, not credential-tiered.** GBIF throttles search traffic according to its own server load and returns 429 when a caller exceeds it; no credential raises the ceiling. Requests carry an identifying `User-Agent` (overridable via `GBIF_USER_AGENT`) so GBIF can make contact about problem traffic.
- **WKT geometry coordinate order.** GBIF expects `longitude latitude` order in WKT (matching GeoJSON convention, not GML). This is noted in the `geometry` parameter description.

---

## API Reference

### Base URL

`https://api.gbif.org/v1`

### Key endpoints

| Resource | Endpoint | Notes |
|:---------|:---------|:------|
| Species match | `GET /species/match` | `name`, `strict`, `kingdom`, `rank` |
| Species get | `GET /species/{key}` | backbone taxon key |
| Species search | `GET /species/search` | `q`, `rank`, `kingdom`, `datasetKey`, `limit`, `offset` |
| Species children | `GET /species/{key}/children` | paginated |
| Species parents | `GET /species/{key}/parents` | returns array root→leaf |
| Occurrence search | `GET /occurrence/search` | Darwin Core filters + facets |
| Occurrence count | `GET /occurrence/search` at `limit=0` | full Darwin Core filter set; `/occurrence/count` is used only for the dataset record-count lookup, since its closed parameter set rejects `occurrenceStatus` and `iucnRedListCategory` |
| Occurrence get | `GET /occurrence/{key}` | full DwC record |
| Dataset search | `GET /dataset/search` | q, type, publishingCountry |
| Dataset get | `GET /dataset/{uuid}` | |
| Publisher search | `GET /organization/search` | q, country |

### Pagination pattern

All list endpoints return: `{ offset, limit, endOfRecords, count, results[] }`. Page with `offset` + `limit`. Occurrence search: capped at `offset + limit ≤ 100,001`.

### Facet query pattern

Add `facet=FIELD_NAME` to occurrence search, set `limit=0` to skip record fetching. Add `facetLimit=N` (default 10, max 100) and `facetMincount=N` to filter low-count values. Multiple `facet=` parameters are allowed in a single request.

### Name matching confidence

| Confidence | Interpretation |
|:-----------|:---------------|
| 90–100 | High confidence — exact or near-exact match |
| 80–89 | Good match — minor differences (author, formatting) |
| 60–79 | Fuzzy match — verify before use |
| <60 | Low confidence — likely a different species |

### Auth

None. GBIF issues no API key, and the read endpoints this server calls take no credentials. GBIF's HTTP Basic auth — a GBIF.org username and password, with no API-key alternative — applies only to occurrence downloads and registry writes, neither of which is in this surface. Search traffic is throttled by GBIF's server load and returns 429 when it exceeds the current ceiling.

### Error shapes

```json
// 404
{ "timestamp": "...", "status": 404, "error": "", "message": "Entity not found for uri: /species/999" }

// Name match returning no match
{ "confidence": 0, "matchType": "NONE", "synonym": false }
```

---

## Decisions Log

| Date | Decision | Rationale |
|:-----|:---------|:----------|
| 2026-05-23 | `gbif_match_species` as mandatory first step — returns backbone `taxonKey` required by downstream tools | Backbone key is the stable cross-API identifier; synonym resolution happens here so occurrence tools don't need to duplicate it |
| 2026-05-23 | `gbif_occurrence_facets` as a standalone tool, not a mode on `gbif_search_occurrences` | Facet-only queries (limit=0) are semantically different from record fetches — naming them separately makes intent clearer and avoids teaching agents the `limit=0` idiom |
| 2026-05-23 | No occurrence download tool | The Download API authenticates with a GBIF.org username and password (no API-key mode), so a keyless multi-tenant server would have to share one account's credentials, quota, and notification inbox; the job/poll/ZIP shape has no synchronous MCP equivalent, and the archive can hold tens of millions of rows no agent context can read |
| 2026-08-06 | No complete-retrieval path past the pagination cap — ship accurate guidance instead | `/occurrence/search` exposes no cursor or scroll and ignores unrecognized parameters with a 200, so nothing continues past offset+limit 100,001. Caller-side partitioning on `datasetKey` is the only route through this surface and needs unbounded, data-dependent recursion, so it belongs in the guidance rather than in a tool |
| 2026-08-06 | `DATASET_KEY` named as the partition dimension, in the `facet` description | Every occurrence carries exactly one `datasetKey`, so its buckets sum to the scope's total, and it is the only gap-free dimension with the cardinality to reach pageable pieces (`basisOfRecord` and `publishingCountry` are gap-free but far too coarse for a first cut — 9 and 41 buckets against 550 on the measured scope). `YEAR`, `MONTH`, `STATE_PROVINCE`, and `SPECIES_KEY` silently drop records missing the field (883,550 of 60,290,950 in the measured case). A caller cannot infer the difference from the facet list, and a doc-only note never reaches a model reading `tools/list` |
| 2026-08-06 | `publishingCountry` and `stateProvince` added as filters on all three occurrence tools | `PUBLISHING_COUNTRY` and `STATE_PROVINCE` were offered as facet dimensions with no matching filter anywhere, so those buckets were a dead end — and the partition guidance steers callers toward faceting in the first place. Adding them to only one of the three tools would recreate the search/count/facets disagreement the presence/absence default was fixed to remove, so all three take both. `publishingCountry` also makes `PUBLISHING_COUNTRY` a usable second split axis, which decision 3 previously had to rule out |
| 2026-08-06 | `publishingCountry` constrained by a `^[A-Z]{2}$` pattern; `stateProvince` left unconstrained but announced on an empty result | GBIF answers an unparseable country code with a 400 but a lowercase or alpha-3 form (`us`, `USA`) with 200 and zero records — a silent wrong answer. The vocabulary is closed, so a JSON Schema `pattern` turns every silent case into a local validation error a model can read from `tools/list`. `stateProvince` has no vocabulary to constrain against (`England`, `England - Greater London`, and `Greater London` are three distinct verbatim values), so the guard has to be a runtime notice instead: an empty result under a `stateProvince` filter says the match is verbatim and case-sensitive and points at the `STATE_PROVINCE` facet, which is what separates a misspelling from a genuinely empty region. The pre-existing `country` filter has the same silent-zero behavior and is deliberately left alone here — tightening an already-published parameter is its own change, tracked separately |
| 2026-08-06 | Every partition surface states that the facet call must repeat the query's filters | `gbif_occurrence_facets` accepts fewer filters than the two tools that emit the over-cap notice, so a scope narrowed by `month` or `isGeoreferenced` faces buckets that partition a wider scope than the caller asked about. Left unsaid, "the buckets sum to this total" is wrong exactly when the caller most needs to trust the arithmetic |
| 2026-05-23 | Normalized occurrence output (drop nested `classifications` object) | GBIF includes both CoL and legacy backbone entries per occurrence, creating deep nesting. Top-level Darwin Core fields cover 100% of agent use cases; full detail available via `gbif_get_occurrence` |
| 2026-05-23 | No `gbif_get_species_synonyms` tool in v1 | Niche use case; synonym status already surfaced in `gbif_get_species` — enumerate-all-synonyms workflow can be added later if needed |
| 2026-05-23 | Two resources only (species + dataset) | These are the only stable reference objects with real utility as injectable context; occurrence records are too numerous and publishers too rarely needed |
| 2026-05-23 | Pagination cap surfaced in `paginationNote` field | GBIF silently returns no more data past the cap; explicit warning prevents silent truncation in agent workflows |
| 2026-05-23 | Both WKT geometry and lat/lon ranges exposed as occurrence search params | WKT supports complex polygons (watersheds, protected area boundaries); lat/lon ranges are simpler for rectangular queries — both have clear agent use cases |
| 2026-08-06 | `gbif_match_species` / `gbif_bulk_match_species` return the **accepted** key as `taxonKey`, with the matched synonym key as `matchedTaxonKey` | The tool exists to hand the occurrence tools a key they can filter on; a synonym key returns only the records filed under that name (106 vs 18,961 for *Felis leo*) with nothing marking the gap. Surfacing the accepted key as a second field would have left the documented chain — "pass `taxonKey` to the occurrence tools" — still wrong by default |
| 2026-08-06 | No secondary lookup to resolve the accepted taxon's *name* | `/species/match` reports the accepted taxon as a bare `acceptedUsageKey`, so a name costs one extra request per match — 50 for a full bulk batch. The key is what downstream tools need; the notice points at `gbif_get_species` for callers who want the name |
| 2026-08-06 | `invalid_filter` declared on the taxon-key tools but **not** on the two match tools | `/species/match` answers HTTP 200 for every input those schemas can produce, so declaring the reason there would advertise a failure mode nothing can reach — the same defect as an undeclared one, inverted |
