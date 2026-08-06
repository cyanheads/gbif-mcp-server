# gbif-biodiversity-mcp-server

Global biodiversity occurrence records, taxonomy, and species data via the GBIF API.

## Data source

- **GBIF API v1** — 3.9B+ species occurrence records worldwide
- **Auth**: None — the read endpoints are public and GBIF issues no API key
- **Rate limits**: Throttled by GBIF's server load, returning 429; no credential raises the ceiling

## Why it earns its keep

The canonical source for global biodiversity data. Species observations, specimen records, taxonomy — used by ecologists, conservation biologists, and environmental assessors worldwide. Public good with a large, active research community.

## Target users

- Ecologists and conservation biologists
- Environmental impact assessors
- Educators teaching biodiversity
- Researchers studying species distributions
- Agents combining with nominatim for spatial biodiversity queries

## Scope

- Read-only
- Species search and taxonomy lookup
- Occurrence record queries (by species, location, date range)
- Dataset discovery and metadata
- Publisher/institution browsing
- Species name matching and fuzzy search
- Occurrence maps/counts by region
