/**
 * @fileoverview Annotation conformance across the tool surface. Every tool here
 * issues a live request to api.gbif.org, so every one is an open-world tool.
 *
 * The surface is discovered from the definitions directory and cross-checked
 * against the `tools: [...]` array in the entrypoint, so a tool that is added to
 * one and not the other fails here rather than slipping through unchecked.
 * @module tests/tools/annotations.test
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

interface ToolDefinition {
  annotations?: {
    idempotentHint?: boolean;
    openWorldHint?: boolean;
    readOnlyHint?: boolean;
  };
  name: string;
}

const isToolDefinition = (value: unknown): value is ToolDefinition =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as { name?: unknown }).name === 'string' &&
  typeof (value as { handler?: unknown }).handler === 'function';

const modules = import.meta.glob<Record<string, unknown>>(
  '../../src/mcp-server/tools/definitions/*.tool.ts',
  { eager: true },
);

/** Every exported tool definition, keyed by the export identifier the entrypoint imports. */
const DEFINITIONS = Object.values(modules)
  .flatMap((module) => Object.entries(module))
  .filter((entry): entry is [string, ToolDefinition] => isToolDefinition(entry[1]));

/** Export identifiers listed in the entrypoint's `tools: [...]` array. */
const REGISTERED = (() => {
  const source = readFileSync(
    fileURLToPath(new URL('../../src/index.ts', import.meta.url)),
    'utf-8',
  );
  const block = /\n {2}tools: \[([\s\S]*?)\n {2}\],/.exec(source)?.[1];
  if (!block) throw new Error('Could not locate the tools: [...] array in src/index.ts');
  return block
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
})();

describe('tool annotations', () => {
  it('covers exactly the surface registered in the entrypoint', () => {
    expect(DEFINITIONS.length).toBeGreaterThan(0);
    expect(new Set(DEFINITIONS.map(([exportName]) => exportName))).toEqual(new Set(REGISTERED));
    expect(new Set(DEFINITIONS.map(([, tool]) => tool.name)).size).toBe(DEFINITIONS.length);
  });

  it.each(DEFINITIONS.map(([, tool]) => [tool.name, tool] as const))(
    '%s declares openWorldHint',
    (_name, definition) => {
      expect(definition.annotations?.openWorldHint).toBe(true);
    },
  );

  it.each(DEFINITIONS.map(([, tool]) => [tool.name, tool] as const))(
    '%s is read-only and idempotent',
    (_name, definition) => {
      expect(definition.annotations?.readOnlyHint).toBe(true);
      expect(definition.annotations?.idempotentHint).toBe(true);
    },
  );
});
