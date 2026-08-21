/** W3C RDF test-manifest reader with recursive `mf:include` support. @module */

import { Parser } from 'n3'
import { fromFileUrl, toFileUrl } from '@std/path'

const RDF_TYPE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type'
const RDF_FIRST = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#first'
const RDF_REST = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#rest'
const RDF_NIL = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#nil'
const MF = 'http://www.w3.org/2001/sw/DataAccess/tests/test-manifest#'
const RDFS_LABEL = 'http://www.w3.org/2000/01/rdf-schema#label'

interface TermType {
  readonly termType: string
  readonly value: string
}
interface QuadType {
  readonly subject: TermType
  readonly predicate: TermType
  readonly object: TermType
}

export interface EntryType {
  readonly id: string
  readonly name: string
  readonly types: readonly string[]
  readonly action?: string
  readonly result?: string
  readonly manifest: string
}

export async function readTree(path: string): Promise<EntryType[]> {
  const seen = new Set<string>()
  const entries: EntryType[] = []
  await visit(path, seen, entries)
  return entries
}

async function visit(path: string, seen: Set<string>, output: EntryType[]): Promise<void> {
  const url = toFileUrl(Deno.realPathSync(path)).href
  if (seen.has(url)) return
  seen.add(url)
  const quads = new Parser({ baseIRI: url }).parse(await Deno.readTextFile(path)) as QuadType[]
  const manifests = subjects(quads, RDF_TYPE, `${MF}Manifest`)
  for (const manifest of manifests) {
    for (const include of values(quads, manifest, `${MF}include`)) {
      for (const item of items(quads, include)) await visit(local(item.value), seen, output)
    }
    for (const head of values(quads, manifest, `${MF}entries`)) {
      for (const item of items(quads, head)) output.push(entry(quads, item.value, url))
    }
  }
}

function entry(quads: readonly QuadType[], id: string, manifest: string): EntryType {
  const name = first(quads, id, `${MF}name`)?.value ?? first(quads, id, RDFS_LABEL)?.value ?? id
  const action = first(quads, id, `${MF}action`)?.value
  const result = first(quads, id, `${MF}result`)?.value
  return {
    id,
    name,
    types: values(quads, id, RDF_TYPE).map((value) => value.value),
    ...(action ? { action } : {}),
    ...(result ? { result } : {}),
    manifest,
  }
}

/**
 * Returns manifest references from either an RDF collection or a direct object.
 *
 * Most W3C manifests encode `mf:entries` and `mf:include` as RDF collections.
 * The pinned Microdata-to-RDF suite instead repeats `mf:entries` with direct
 * entry IRIs. Treating every object as a list head crashes before the first
 * Microdata case runs, so the reader recognizes the actual graph shape first.
 */
function items(quads: readonly QuadType[], value: TermType): TermType[] {
  return first(quads, value.value, RDF_FIRST) || first(quads, value.value, RDF_REST)
    ? list(quads, value)
    : [value]
}

function list(quads: readonly QuadType[], head: TermType): TermType[] {
  const result: TermType[] = []
  let node = head
  const seen = new Set<string>()
  while (node.value !== RDF_NIL) {
    if (seen.has(node.value)) throw new TypeError(`Cyclic RDF list in manifest at '${node.value}'.`)
    seen.add(node.value)
    const value = first(quads, node.value, RDF_FIRST)
    const rest = first(quads, node.value, RDF_REST)
    if (!value || !rest) throw new TypeError(`Malformed RDF list in manifest at '${node.value}'.`)
    result.push(value)
    node = rest
  }
  return result
}

function subjects(quads: readonly QuadType[], predicate: string, object: string): string[] {
  return quads.filter((q) => q.predicate.value === predicate && q.object.value === object).map((
    q,
  ) => q.subject.value)
}

function values(quads: readonly QuadType[], subject: string, predicate: string): TermType[] {
  return quads.filter((q) => q.subject.value === subject && q.predicate.value === predicate).map((
    q,
  ) => q.object)
}

function first(
  quads: readonly QuadType[],
  subject: string,
  predicate: string,
): TermType | undefined {
  return values(quads, subject, predicate)[0]
}

function local(value: string): string {
  if (!value.startsWith('file:')) {
    throw new TypeError(`Manifest include is not in the pinned checkout: ${value}`)
  }
  return fromFileUrl(value)
}

/** Converts a manifest action/result IRI resolved against a local file base back to a local path. */
export function localPath(value: string): string {
  if (!value.startsWith('file:')) {
    throw new TypeError(`Manifest resource is not in the pinned checkout: ${value}`)
  }
  return fromFileUrl(value)
}
