<div align="center">
  <h1>@cyanheads/gbif-biodiversity-mcp-server</h1>
  <p><b>Search GBIF species taxonomy, occurrence records, datasets, and publishers via MCP. STDIO or Streamable HTTP.</b>
  <div>13 Tools • 2 Resources</div>
  </p>
</div>

<div align="center">

[![Version](https://img.shields.io/badge/Version-0.6.1-blue.svg?style=flat-square)](./CHANGELOG.md) [![License](https://img.shields.io/badge/License-Apache%202.0-orange.svg?style=flat-square)](./LICENSE) [![Docker](https://img.shields.io/badge/Docker-ghcr.io-2496ED?style=flat-square&logo=docker&logoColor=white)](https://github.com/users/cyanheads/packages/container/package/gbif-biodiversity-mcp-server) [![MCP SDK](https://img.shields.io/badge/MCP%20SDK-^1.30.0-green.svg?style=flat-square)](https://modelcontextprotocol.io/) [![npm](https://img.shields.io/npm/v/@cyanheads/gbif-biodiversity-mcp-server?style=flat-square&logo=npm&logoColor=white)](https://www.npmjs.com/package/@cyanheads/gbif-biodiversity-mcp-server) [![TypeScript](https://img.shields.io/badge/TypeScript-^7.0.2-3178C6.svg?style=flat-square)](https://www.typescriptlang.org/) [![Bun](https://img.shields.io/badge/Bun-v1.3.14-blueviolet.svg?style=flat-square)](https://bun.sh/)

</div>

<div align="center">

[![Install in Claude Desktop](https://img.shields.io/badge/Install_in-Claude_Desktop-D97757?style=for-the-badge&logo=anthropic&logoColor=white)](https://github.com/cyanheads/gbif-biodiversity-mcp-server/releases/latest/download/gbif-biodiversity-mcp-server.mcpb) [![Install in Cursor](https://cursor.com/deeplink/mcp-install-dark.svg)](https://cursor.com/en/install-mcp?name=gbif-biodiversity-mcp-server&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsIkBjeWFuaGVhZHMvZ2JpZi1iaW9kaXZlcnNpdHktbWNwLXNlcnZlciJdfQ==) [![Install in VS Code](https://img.shields.io/badge/VS_Code-Install_Server-0098FF?style=for-the-badge&logo=visualstudiocode&logoColor=white)](https://vscode.dev/redirect?url=vscode:mcp/install?%7B%22name%22%3A%22gbif-biodiversity-mcp-server%22%2C%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22%40cyanheads%2Fgbif-biodiversity-mcp-server%22%5D%7D)

[![Framework](https://img.shields.io/badge/Built%20on-@cyanheads/mcp--ts--core-67E8F9?style=flat-square)](https://www.npmjs.com/package/@cyanheads/mcp-ts-core)

**Public Hosted Server:** [https://gbif-biodiversity.caseyjhand.com/mcp](https://gbif-biodiversity.caseyjhand.com/mcp)

</div>

---

## Tools

13 tools for working with GBIF species taxonomy, occurrence records, datasets, and publishers:

| Tool | Description |
|:---|:---|
| `gbif_match_species` | Match a species name against the GBIF backbone taxonomy — returns taxonKey, confidence score, and full classification |
| `gbif_bulk_match_species` | Match up to 50 scientific names to backbone taxon keys in one call — results in input order, per-name NONE/ERROR isolation |
| `gbif_get_species` | Fetch a single backbone taxon by key — full classification, authorship, synonymy, vernacular name, descendant count |
| `gbif_search_species` | Search or browse the GBIF backbone taxonomy by name fragment, rank, kingdom, family, or genus |
| `gbif_get_species_classification` | Return the root-to-parent classification chain for a taxon — root-first ordered array from kingdom to the queried taxon's immediate parent (the taxon itself is not included) |
| `gbif_get_species_children` | List direct children of a backbone taxon — genera within a family, species within a genus |
| `gbif_search_occurrences` | Search 3.9B+ GBIF occurrence records with Darwin Core filters — country, publishing country, state/province, bounding box, WKT geometry, year, month, basis of record, presence/absence, IUCN Red List category |
| `gbif_count_occurrences` | Count occurrences matching a filter without fetching records — fast single-number response, filtered to sightings by default |
| `gbif_get_occurrence` | Fetch a single occurrence record by key — full Darwin Core record with GADM geography, presence/absence status, conservation status, media, and quality flags |
| `gbif_occurrence_facets` | Aggregate occurrence counts by a dimension — country, year, basis of record, dataset, kingdom, presence/absence, IUCN Red List category |
| `gbif_search_datasets` | Search GBIF datasets by keyword, type, country, or publishing organization |
| `gbif_get_dataset` | Fetch full dataset metadata by UUID — title, description, citation, contacts, license, DOI, coverage |
| `gbif_search_publishers` | Search GBIF-registered publishing organizations by name fragment or country |

### `gbif_match_species`

Match a scientific or common name against the GBIF backbone taxonomy.

- Fuzzy matching handles minor typos and vernacular names; set `strict: true` for exact-only matching
- Returns `taxonKey` — the backbone key required by `gbif_search_occurrences`, `gbif_count_occurrences`, and `gbif_occurrence_facets`
- Confidence score 0–100; below 80 warrants review
- Full classification hierarchy with keys at each rank: kingdom, phylum, class, order, family, genus, species
- `matchType NONE` indicates no usable match — try removing strict mode or broadening the name
- Resolves synonyms: always returns the accepted backbone key regardless of which name form was queried; `matchedTaxonKey` carries the synonym's own key when the two differ

---

### `gbif_bulk_match_species`

Match up to 50 scientific names against the GBIF backbone taxonomy in a single call.

- The batch counterpart to `gbif_match_species` — built for checklist, inventory, and species-list workflows that would otherwise need one round trip per name
- Returns one result per input name, in input order; each carries `taxonKey`, `matchType`, and confidence
- Per-name isolation: an unmatched name yields `matchType NONE` and a per-name lookup failure yields `matchType ERROR` with the message and, when the failure was classified, a `reason` — neither sinks the rest of the batch
- Same synonym resolution as `gbif_match_species`: `taxonKey` is the accepted taxon, `matchedTaxonKey` the synonym it was queried under
- `strict: true` requires an exact match for every name; common names are not supported (use `gbif_search_species`)

---

### `gbif_get_species`

Fetch a complete taxon record by GBIF backbone key.

- Full classification, authorship string, and vernacular (English) name when available
- `taxonomicStatus`: ACCEPTED, SYNONYM, DOUBTFUL — when SYNONYM, `acceptedKey` and `accepted` identify the current name
- `numDescendants` and `numOccurrences` for scope at a glance
- `extinct` field present only when explicitly flagged — not false on unlabeled taxa
- `publishedIn` carries the original description citation when available

---

### `gbif_search_species`

Search or browse the GBIF backbone taxonomy.

- Accepts name fragments matching scientific and vernacular names
- Filter by rank, kingdom, family, or genus to scope browsing
- `isExtinct` filter for extinct vs. extant taxa
- Scope to a specific checklist dataset with `datasetKey` (omit for the GBIF backbone)
- Paginated — limit up to 1000, use offset to walk through large groups

---

### `gbif_get_species_classification`

Return the root-to-parent classification chain for a taxon as an ordered array.

- Root-first from kingdom down to the immediate parent of the queried taxon (kingdom → phylum → class → … → parent)
- The queried taxon itself is not included — use `gbif_get_species` for its own record
- Each entry: rank, canonical name, scientific name, taxon key
- Useful for building taxonomic trees or placing an unfamiliar taxon in context without manual backbone navigation

---

### `gbif_get_species_children`

List direct children of a backbone taxon.

- Genera within a family, species within a genus, subspecies within a species
- Each child: key, name, rank, taxonomic status, common name, occurrence count, descendant count
- Paginated — limit up to 1000, iterate with offset for large groups like Coleoptera

---

### `gbif_search_occurrences`

Search 3.9B+ GBIF occurrence records with full Darwin Core filtering.

- Use `taxonKey` from `gbif_match_species` for reliable results — resolves synonyms automatically; `scientificName` filter does not
- Geographic filters: `country` (ISO 3166-1 alpha-2), `stateProvince`, bounding box (`decimalLatitude`/`decimalLongitude` ranges as "min,max"), or WKT polygon (`geometry`)
- `publishingCountry` (ISO 3166-1 alpha-2, uppercase) is the country of the *publishing organization*, not of the observation — a different question from `country`, and the two disagree on most records: of 60,290,950 records observed in GB, 1,548,928 were published by US organizations
- `stateProvince` is matched verbatim — exact and case-sensitive, with no controlled vocabulary behind it. Take a value from a `STATE_PROVINCE` facet rather than guessing; an unmatched value returns zero records instead of an error, and the enrichment notice says so when it happens
- Temporal filters: `year` as single year or range, `month` (1–12) for seasonal queries
- `basisOfRecord` enum: `HUMAN_OBSERVATION`, `PRESERVED_SPECIMEN`, `MACHINE_OBSERVATION`, and more
- `hasCoordinate` to require or exclude georeferenced records
- `occurrenceStatus` — `PRESENT` (default), `ABSENT`, or `ANY`. GBIF indexes absence records (a survey that looked for the taxon and did not find it) alongside sightings; the default excludes them and the enrichment says so on every call
- `iucnRedListCategory` — `CR`, `EN`, `VU`, `NT`, `LC`, `DD`, `EX`, `EW`, `CD`
- Output per record adds `taxonomicStatus`, `eventTime` (with UTC offset), `occurrenceStatus`, and `iucnRedListCategory`
- Pagination capped at offset+limit = 100,001, the deepest page GBIF serves. The API has no cursor or scroll, so a larger result set is covered by partitioning it — facet by `DATASET_KEY` with `gbif_occurrence_facets`, then search each `datasetKey` on its own. Retrieving a set in one piece is not something this server can do: that needs GBIF's Download API with a GBIF.org account, or GBIF's monthly snapshot on AWS Open Data

---

### `gbif_count_occurrences`

Count occurrences matching a filter without fetching any records.

- Backed by `/occurrence/search` at `limit=0` — no record payload, and the same endpoint `gbif_search_occurrences` queries, so the two agree on the same question. GBIF's dedicated `/occurrence/count` endpoint takes a closed parameter set that rejects `occurrenceStatus` and `iucnRedListCategory` outright
- Supported filters: `taxonKey`, `country`, `publishingCountry`, `stateProvince`, `isGeoreferenced`, `datasetKey`, `year`, `occurrenceStatus`, `iucnRedListCategory`
- Counts sightings only by default, matching `gbif_search_occurrences`. For absence-heavy taxa the unfiltered figure is a different question entirely — *Radicipes gracilis* has 2,351,582 indexed records of which 79 are presences
- Use to assess result set size before deciding whether to paginate a full search. A count above 100,001 means paging cannot reach the end of it, and the enrichment notice says so and names the partition route

---

### `gbif_get_occurrence`

Fetch a single occurrence record by GBIF occurrence key.

- Complete Darwin Core record — all coordinate fields, administrative geography (continent, country, state/province, locality), dates
- `occurrenceID`, full classification (`class`/`classKey`), GADM administrative units (levels 0–3, each with a stable GID and name), and source `identifiers`
- `occurrenceStatus` — check it before reading the record as a sighting; `ABSENT` means a survey looked and found nothing, and the record still carries coordinates, a date, and a recorder
- `taxonomicStatus`, `eventTime` (with UTC offset), and `iucnRedListCategory`
- Collections metadata: institution code, collection code, catalog number
- Collector and identifier names, individual count, sex, life stage
- Associated media (images, audio, video) with URLs and license
- GBIF data quality issue flags for provenance assessment

---

### `gbif_occurrence_facets`

Aggregate occurrence counts across a dimension.

- Facets: `COUNTRY`, `STATE_PROVINCE`, `YEAR`, `BASIS_OF_RECORD`, `DATASET_KEY`, `KINGDOM_KEY`, `PHYLUM_KEY`, `CLASS_KEY`, `ORDER_KEY`, `FAMILY_KEY`, `GENUS_KEY`, `SPECIES_KEY`, `PUBLISHING_COUNTRY`, `MONTH`, `OCCURRENCE_STATUS`, `IUCN_RED_LIST_CATEGORY`
- Scope with `taxonKey`, `country`, `publishingCountry`, `stateProvince`, `year`, `geometry`, `basisOfRecord`, `datasetKey`, `occurrenceStatus`, or `iucnRedListCategory` filters — so a `PUBLISHING_COUNTRY` or `STATE_PROVINCE` bucket can be passed straight back to drill into it
- Aggregates sightings only by default, matching the search and count tools. To measure the presence/absence split itself, pass `facet: OCCURRENCE_STATUS` with `occurrenceStatus: ANY`
- Returns one page of values ranked by count descending — up to `facetLimit` (max 100), the top ones only while `facetOffset` is 0 — with no record payloads
- `DATASET_KEY` is the basis for splitting a result set too large for `gbif_search_occurrences` to page: every occurrence carries exactly one `datasetKey`, so its buckets sum to the scope's full total, and it has the cardinality to cut a large scope into pageable pieces. `BASIS_OF_RECORD` and `PUBLISHING_COUNTRY` are gap-free too and both have a matching filter on the occurrence tools, so either can drive a further split of a bucket still over the cap — but on that scope they return 9 and 41 buckets against `DATASET_KEY`'s 550, too coarse for the first cut. A dimension a record can lack drops that record: a 60,290,950-record scope faceted by `YEAR` sums to 59,407,400, leaving 883,550 undated records out, and `MONTH`, `STATE_PROVINCE`, and `SPECIES_KEY` behave the same way — `STATE_PROVINCE` included, even though the occurrence tools can filter on it
- The scope filters here are narrower than `gbif_search_occurrences` accepts — no `scientificName`, `month`, bounding box, `hasCoordinate`, `isInCluster`, or `coordinateUncertaintyInMeters`. Buckets sum to a search's total only when both calls carry the same filters; re-apply the rest on each per-`datasetKey` search
- Page past the first `facetLimit` with `facetOffset` (advance by `facetLimit` per page) to walk high-cardinality facets like `DATASET_KEY`; enrichment echoes the applied `facetOffset` and sets `moreValuesLikely` when a full page suggests more values remain
- Core tool for distribution analysis ("which countries have the most records?") and trend queries ("how has observation volume changed since 2010?")

---

### `gbif_search_datasets`

Search GBIF datasets by keyword, type, country, or publishing organization.

- Filters: free-text query, dataset type (`OCCURRENCE`, `CHECKLIST`, `METADATA`, `SAMPLING_EVENT`), publishing country, hosting organization UUID
- Returns title, type, description, license, DOI, and record count. `recordCount` spans every `occurrenceStatus`, absences included — `gbif_count_occurrences` with the same key counts sightings only by default, so the two figures differ by design
- The `description` is a 300-character preview — `descriptionTruncated` flags when it was shortened, and `gbif_get_dataset` returns the full text
- Use `hostingOrg` from `gbif_search_publishers` to scope to datasets from one organization
- Paginated — limit up to 1000

---

### `gbif_get_dataset`

Fetch full dataset metadata by UUID.

- Full description, citation text (for academic reference), license, DOI
- Contacts with role, name, organization, and email
- Temporal and geographic coverage ranges when the publisher declares them
- `recordCount` — the indexed occurrence total, matching what `gbif_search_datasets` reports, for every dataset type (a `CHECKLIST` reports 0). It spans every `occurrenceStatus`, absences included; `gbif_count_occurrences` with the same key counts sightings only by default, so the two figures differ by design
- `numConstituents` for aggregate datasets (e.g. iNaturalist, eBird)
- Use after `gbif_search_datasets` or when an occurrence record's `datasetKey` needs provenance detail

---

### `gbif_search_publishers`

Search organizations registered with GBIF.

- Filter by name fragment or country
- Returns organization key, title, and country — sufficient to chain into `gbif_search_datasets` with `hostingOrg`
- Paginated — limit up to 1000

## Resources

| Type | Name | Description |
|:---|:---|:---|
| Resource | `gbif://species/{taxonKey}` | Taxon record from the GBIF backbone — classification, authorship, synonymy status, vernacular name |
| Resource | `gbif://dataset/{datasetKey}` | Dataset metadata — title, description, citation, license, contacts, coverage |

## Features

Built on [`@cyanheads/mcp-ts-core`](https://github.com/cyanheads/mcp-ts-core):

- Declarative tool definitions — single file per tool, framework handles registration and validation
- Unified error handling across all tools
- Pluggable auth (`none`, `jwt`, `oauth`)
- Swappable storage backends: `in-memory`, `filesystem`, `Supabase`, `Cloudflare KV/R2/D1`
- Structured logging with optional OpenTelemetry tracing
- Runs locally (stdio/HTTP) or on Cloudflare Workers from the same codebase

GBIF-specific:

- Full GBIF REST API v1 coverage: species taxonomy, occurrences, datasets, and publishers
- `gbif_match_species` as the entry point — resolves synonyms to backbone taxon keys used throughout
- Occurrence pagination guarded at GBIF's own offset+limit = 100,001 boundary — an over-cap request fails locally with a recovery hint naming the `DATASET_KEY` partition technique, instead of spending the retry budget on a deterministic upstream rejection, and a match larger than the cap says so on the first page rather than after hundreds of them
- WKT polygon geometry support for geographic occurrence queries
- Darwin Core field mapping with explicit provenance on sparse upstream fields

Agent-friendly output:

- `gbif_match_species` is the mandatory first step — all downstream tools document which key they expect
- Graceful sparse-field handling — optional fields absent from the API response are omitted rather than null-filled
- Discriminated error contracts with typed reasons, structured recovery hints, and `when` documentation per tool

## Getting started

### Self-Hosted / Local

Add the following to your MCP client configuration file.

```json
{
  "mcpServers": {
    "gbif-biodiversity-mcp-server": {
      "type": "stdio",
      "command": "bunx",
      "args": ["@cyanheads/gbif-biodiversity-mcp-server@latest"],
      "env": {
        "MCP_TRANSPORT_TYPE": "stdio",
        "MCP_LOG_LEVEL": "info"
      }
    }
  }
}
```

Or with npx (no Bun required):

```json
{
  "mcpServers": {
    "gbif-biodiversity-mcp-server": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@cyanheads/gbif-biodiversity-mcp-server@latest"],
      "env": {
        "MCP_TRANSPORT_TYPE": "stdio",
        "MCP_LOG_LEVEL": "info"
      }
    }
  }
}
```

Or with Docker:

```json
{
  "mcpServers": {
    "gbif-biodiversity-mcp-server": {
      "type": "stdio",
      "command": "docker",
      "args": ["run", "-i", "--rm", "-e", "MCP_TRANSPORT_TYPE=stdio", "ghcr.io/cyanheads/gbif-biodiversity-mcp-server:latest"]
    }
  }
}
```

For Streamable HTTP, set the transport and start the server:

```sh
MCP_TRANSPORT_TYPE=http MCP_HTTP_PORT=3010 bun run start:http
# Server listens at http://localhost:3010/mcp
```

### Prerequisites

- [Bun v1.3.0](https://bun.sh/) or higher.
- No credentials — the GBIF endpoints this server calls are public.

### Installation

1. **Clone the repository:**

```sh
git clone https://github.com/cyanheads/gbif-biodiversity-mcp-server.git
```

2. **Navigate into the directory:**

```sh
cd gbif-biodiversity-mcp-server
```

3. **Install dependencies:**

```sh
bun install
```

## Configuration

All configuration is validated at startup via Zod schemas in `src/config/server-config.ts`. Key environment variables:

| Variable | Description | Default |
|:---|:---|:---|
| `MCP_TRANSPORT_TYPE` | Transport: `stdio` or `http` | `stdio` |
| `MCP_HTTP_PORT` | HTTP server port | `3010` |
| `MCP_HTTP_ENDPOINT_PATH` | HTTP endpoint path where the MCP server is mounted | `/mcp` |
| `MCP_PUBLIC_URL` | Public origin override for TLS-terminating reverse-proxy deployments | none |
| `MCP_AUTH_MODE` | Authentication: `none`, `jwt`, or `oauth` | `none` |
| `MCP_LOG_LEVEL` | Log level (`debug`, `info`, `warning`, `error`, etc.) | `info` |
| `MCP_GC_PRESSURE_INTERVAL_MS` | Opt-in Bun-only forced-GC pressure loop (ms). Try `60000` if RSS grows under sustained HTTP load. | `0` (disabled) |
| `LOGS_DIR` | Directory for log files (Node.js only) | `<project-root>/logs` |
| `STORAGE_PROVIDER_TYPE` | Storage backend: `in-memory`, `filesystem`, `supabase`, `cloudflare-kv/r2/d1` | `in-memory` |
| `GBIF_BASE_URL` | GBIF API base URL override | `https://api.gbif.org/v1` |
| `GBIF_REQUEST_TIMEOUT_MS` | HTTP request timeout in milliseconds | `10000` |
| `GBIF_USER_AGENT` | `User-Agent` sent on every GBIF request. GBIF asks integrators to identify themselves with a contact URL or email. | server name, version, and repository URL |
| `OTEL_ENABLED` | Enable OpenTelemetry | `false` |

## Running the server

### Local development

- **Build and run the production version**:

  ```sh
  # One-time build
  bun run rebuild

  # Run the built server
  bun run start:http
  # or
  bun run start:stdio
  ```

- **Run checks and tests**:
  ```sh
  bun run devcheck  # Lints, formats, type-checks, and more
  bun run test      # Runs the test suite
  ```

## Project structure

| Directory | Purpose |
|:---|:---|
| `src/mcp-server/tools` | Tool definitions (`*.tool.ts`). Thirteen tools across species taxonomy, occurrences, datasets, and publishers. |
| `src/mcp-server/resources` | Resource definitions. Species and dataset stable-URI resources. |
| `src/services/gbif` | GBIF REST API service layer — client, request handling, type definitions. |
| `src/config` | Server-specific environment variable parsing and validation with Zod. |
| `tests/` | Unit and integration tests, mirroring the `src/` structure. |

## Development guide

See [`CLAUDE.md`](./CLAUDE.md) for development guidelines and architectural rules. The short version:

- Handlers throw, framework catches — no `try/catch` in tool logic
- Use `ctx.log` for logging, `ctx.state` for storage
- Register new tools and resources in the `createApp()` arrays

## Contributing

Issues and pull requests are welcome. Run checks and tests before submitting:

```sh
bun run devcheck
bun run test
```

## License

This project is licensed under the Apache 2.0 License. See the [LICENSE](./LICENSE) file for details.
