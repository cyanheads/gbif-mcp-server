/**
 * @fileoverview Shared utilities for tool definitions.
 * @module mcp-server/tools/utils
 */

import type { Context } from '@cyanheads/mcp-ts-core';
import { getGbifService } from '@/services/gbif/gbif-service.js';
import type {
  RawContact,
  RawDatasetRecord,
  RawGeographicCoverage,
  RawTemporalCoverage,
} from '@/services/gbif/types.js';

/** Canonical 8-4-4-4-12 hex UUID — the form every GBIF dataset and organization key takes. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * True when `value` is a well-formed GBIF registry key (dataset, organization).
 *
 * Callers check before issuing a request because GBIF handles a malformed key two
 * incompatible ways: most endpoints answer HTTP 400 `Invalid UUID string`, but
 * `/occurrence/count` answers 200 with a count of 0 — a wrong answer rather than
 * an error. Rejecting locally makes both cases one explicit failure.
 *
 * Matched without trimming, because callers forward the value they were given
 * rather than a normalized copy: accepting surrounding whitespace here would wave
 * through a key that still reaches `/occurrence/count` malformed, restoring the
 * silent zero this check exists to prevent.
 */
export function isGbifUuid(value: string): boolean {
  return UUID.test(value);
}

/**
 * Record count for a dataset detail response, shared by `gbif_get_dataset` and the
 * `gbif://dataset/{datasetKey}` resource.
 *
 * `/dataset/{key}` supplies neither `numRecords` nor `recordCount` for any dataset,
 * while `/dataset/search` supplies `recordCount` — so a detail lookup would report
 * less than the list tool it is meant to expand on. An OCCURRENCE dataset closes
 * that gap with the indexed occurrence count, which is the figure search reports.
 * Other dataset types have no equivalent, and the extra lookup is best-effort, so
 * the field stays absent rather than blocking or failing the record.
 */
export function resolveDatasetRecordCount(
  raw: RawDatasetRecord,
  ctx: Context,
): Promise<number | undefined> {
  const declared = raw.numRecords ?? raw.recordCount;
  if (declared != null) return Promise.resolve(declared);
  if (raw.type !== 'OCCURRENCE' || !raw.key) return Promise.resolve(undefined);
  return getGbifService().getDatasetOccurrenceCount(raw.key, ctx);
}

/**
 * Project raw dataset contacts to a `limit`-capped, compact list plus total/returned counts.
 * Shared by `gbif_get_dataset` (caller-supplied `contactLimit`) and the `gbif://dataset/{key}`
 * resource (fixed cap). `contactsTotal`/`contactsReturned` are included only when the dataset
 * has any contacts, so callers can spread the result directly into their output object.
 */
export function projectContacts(raw: RawContact[] | undefined, limit: number) {
  const all = raw ?? [];
  const contacts = all.slice(0, limit).map((c) => ({
    type: c.type,
    firstName: c.firstName,
    lastName: c.lastName,
    organization: c.organization,
    email: c.email?.length ? c.email : undefined,
  }));
  return {
    contacts: contacts.length ? contacts : undefined,
    ...(all.length > 0 && { contactsTotal: all.length, contactsReturned: contacts.length }),
  };
}

/**
 * Project raw dataset temporal coverages to compact `{ start, end }` ranges, keeping only
 * entries that carry at least one bound (GBIF also emits verbatim/single-date shapes we skip).
 * Returns undefined when nothing survives, so the field is omitted rather than empty.
 */
export function compactTemporalCoverages(raw: RawTemporalCoverage[] | undefined) {
  const ranges = (raw ?? [])
    .map((t) => ({ start: t.start, end: t.end }))
    .filter((t) => t.start || t.end);
  return ranges.length ? ranges : undefined;
}

/**
 * Project raw dataset geographic coverages to compact `{ description }` entries, keeping only
 * those that carry a description. Returns undefined when nothing survives.
 */
export function compactGeographicCoverages(raw: RawGeographicCoverage[] | undefined) {
  const entries = (raw ?? [])
    .map((g) => ({ description: g.description }))
    .filter((g) => g.description);
  return entries.length ? entries : undefined;
}

/** Strip HTML tags and decode common entities. */
export function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#34;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#61;/g, '=')
    .replace(/&#43;/g, '+')
    .replace(/\s+/g, ' ')
    .trim();
}
