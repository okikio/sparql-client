/**
 * SPARQL 1.1 Update operations.
 * 
 * SPARQL Update provides operations for modifying RDF data. These complement
 * queries (SELECT/ASK/CONSTRUCT) by letting you insert, delete, and manage
 * graph data. Updates execute against an update endpoint (often different
 * from the query endpoint).
 * 
 * The pattern mirrors the query builder: start with an operation type (insert,
 * delete, modify), add details, then build or execute. Each operation is
 * immutable - methods return new builders rather than modifying existing ones.
 * 
 * @example Insert data
 * ```ts
 * insert(triples('ex:person1', [
 *   ['rdf:type', 'foaf:Person'],
 *   ['foaf:name', str('Alice')],
 *   ['foaf:age', num(30)]
 * ]))
 *   .execute(config)
 * ```
 * 
 * @example Conditional update
 * ```ts
 * modify()
 *   .delete(triple('?person', 'foaf:age', '?oldAge'))
 *   .insert(triple('?person', 'foaf:age', '?newAge'))
 *   .where(triple('?person', 'foaf:age', '?oldAge'))
 *   .where(bind(add(v('oldAge'), 1), 'newAge'))
 *   .done()
 *   .execute(config)
 * ```
 * 
 * @module
 */

import { raw, sparql, type SparqlValue } from './sparql.ts'
import { createExecutor, type ExecutorConfig, type SparqlResult } from './executor.ts'

// ============================================================================
// Update Operation Types
// ============================================================================

/**
 * Internal state for update operations.
 * 
 * This is immutable - each method creates a new state object rather than
 * modifying the existing one.
 */
interface UpdateState {
  readonly operations: UpdateOperation[]
}

/**
 * Individual update operation.
 */
interface UpdateOperation {
  readonly type: 'INSERT_DATA' | 'DELETE_DATA' | 'DELETE_WHERE' | 'DELETE_INSERT' | 'LOAD' | 'CLEAR' | 'DROP' | 'CREATE' | 'COPY' | 'MOVE' | 'ADD'
  readonly data?: SparqlValue
  readonly where?: SparqlValue
  readonly graph?: string
  readonly deleteTemplate?: SparqlValue
  readonly insertTemplate?: SparqlValue
  readonly silent?: boolean
  readonly source?: string
  readonly dest?: string
}

/**
 * Initial empty state for updates.
 */
const initialUpdateState: UpdateState = {
  operations: []
}

// ============================================================================
// Update Builder
// ============================================================================

/**
 * Builder for SPARQL Update operations.
 * 
 * Each method returns a new UpdateBuilder with updated state. This immutability
 * means you can safely store intermediate builders and branch from them.
 * 
 * @example Building incrementally
 * ```ts
 * const baseUpdate = update()
 *   .insertData(triple('ex:person1', 'rdf:type', 'foaf:Person'))
 * 
 * // Add more operations
 * const fullUpdate = baseUpdate
 *   .insertData(triple('ex:person1', 'foaf:name', str('Alice')))
 * ```
 */
export class UpdateBuilder {
  constructor(private readonly state: UpdateState) {}

  /**
   * Start building an update operation.
   * 
   * Returns an empty builder you can add operations to. Operations are executed
   * in the order you add them.
   * 
   * @example Multiple operations
   * ```ts
   * update()
   *   .insertData(triple('ex:person1', 'foaf:name', str('Alice')))
   *   .insertData(triple('ex:person2', 'foaf:name', str('Bob')))
   *   .execute(config)
   * ```
   */
  static create(): UpdateBuilder {
    return new UpdateBuilder(initialUpdateState)
  }

  /**
   * Insert RDF triples (INSERT DATA).
   * 
   * Adds triples directly to the dataset. The triples must be ground (no variables) -
   * all subjects, predicates, and objects must be concrete values, not variables.
   * For conditional inserts based on patterns, use modify() instead.
   * 
   * @param data Triples to insert (must be ground)
   * @param graph Optional named graph to insert into
   * 
   * @example Insert person data
   * ```ts
   * insertData(triples('ex:person1', [
   *   ['rdf:type', 'foaf:Person'],
   *   ['foaf:name', str('Alice')],
   *   ['foaf:age', num(30)]
   * ]))
   * ```
   * 
   * @example Insert into named graph
   * ```ts
   * insertData(
   *   triple('ex:fact1', 'ex:statement', str('Data added today')),
   *   'http://example.org/graph/metadata'
   * )
   * ```
   */
  insertData(data: SparqlValue, graph?: string): UpdateBuilder {
    return new UpdateBuilder({
      operations: [
        ...this.state.operations,
        { type: 'INSERT_DATA', data, graph }
      ]
    })
  }

  /**
   * Delete RDF triples (DELETE DATA).
   * 
   * Removes triples from the dataset. The triples must be ground (no variables) -
   * you must specify exact triples to delete. For pattern-based deletion,
   * use deleteWhere() or modify() instead.
   * 
   * @param data Triples to delete (must be ground)
   * @param graph Optional named graph to delete from
   * 
   * @example Delete specific triple
   * ```ts
   * deleteData(triple('ex:person1', 'foaf:age', num(30)))
   * ```
   * 
   * @example Delete multiple triples
   * ```ts
   * deleteData(triples('ex:person1', [
   *   ['foaf:age', num(30)],
   *   ['foaf:email', str('old@example.com')]
   * ]))
   * ```
   */
  deleteData(data: SparqlValue, graph?: string): UpdateBuilder {
    return new UpdateBuilder({
      operations: [
        ...this.state.operations,
        { type: 'DELETE_DATA', data, graph }
      ]
    })
  }

  /**
   * Delete triples matching a pattern (DELETE WHERE).
   * 
   * Finds all triples matching the pattern and deletes them. The pattern can
   * contain variables - anything that matches gets deleted. This is shorthand
   * for DELETE/INSERT where the delete and where templates are the same.
   * 
   * @param pattern Pattern of triples to delete
   * 
   * @example Delete all ages
   * ```ts
   * deleteWhere(triple('?person', 'foaf:age', '?age'))
   * // Deletes age for all people
   * ```
   * 
   * @example Delete specific person's data
   * ```ts
   * deleteWhere(triple('ex:person1', '?property', '?value'))
   * // Deletes all triples with ex:person1 as subject
   * ```
   * 
   * @example Complex pattern
   * ```ts
   * deleteWhere(raw(`
   *   ?person foaf:age ?age .
   *   FILTER(?age < 0)
   * `))
   * // Deletes invalid ages
   * ```
   */
  deleteWhere(pattern: SparqlValue): UpdateBuilder {
    return new UpdateBuilder({
      operations: [
        ...this.state.operations,
        { type: 'DELETE_WHERE', where: pattern }
      ]
    })
  }

  /**
   * Start a DELETE/INSERT operation.
   * 
   * Combines deletion and insertion in one operation. Finds matches with WHERE,
   * deletes according to DELETE template, inserts according to INSERT template.
   * This is the most powerful update operation - use it when you need to transform
   * data based on patterns.
   * 
   * Chain with .delete(), .insert(), and .where() to build the operation.
   * Call .done() when finished to return to the main UpdateBuilder.
   * 
   * @example Update ages
   * ```ts
   * modify()
   *   .delete(triple('?person', 'foaf:age', '?oldAge'))
   *   .insert(triple('?person', 'foaf:age', '?newAge'))
   *   .where(triple('?person', 'foaf:age', '?oldAge'))
   *   .where(bind(add(v('oldAge'), 1), 'newAge'))
   *   .done()
   * ```
   * 
   * @example Conditional insert
   * ```ts
   * modify()
   *   .insert(triple('?person', 'ex:adult', bool(true)))
   *   .where(triple('?person', 'foaf:age', '?age'))
   *   .where(filter(gte(v('age'), 18)))
   *   .done()
   * // Adds "adult" marker to people 18+, without deleting anything
   * ```
   */
  modify(): ModifyBuilder {
    return new ModifyBuilder(this.state, undefined, undefined, [])
  }

  /**
   * Load RDF from a URL.
   * 
   * Fetches RDF from the specified URL and adds it to the dataset. The URL
   * must return RDF in a format the endpoint understands (Turtle, RDF/XML, etc.).
   * 
   * @param url URL to load from
   * @param graph Optional target graph (default: default graph)
   * @param silent Don't fail if URL unreachable (default: false)
   * 
   * @example Load Turtle file
   * ```ts
   * load('http://example.org/data.ttl')
   * ```
   * 
   * @example Load into named graph
   * ```ts
   * load(
   *   'http://example.org/data.ttl',
   *   'http://example.org/graph1'
   * )
   * ```
   * 
   * @example Silent load
   * ```ts
   * load('http://example.org/data.ttl', undefined, true)
   * // Continues even if URL is unreachable
   * ```
   */
  load(url: string, graph?: string, silent = false): UpdateBuilder {
    return new UpdateBuilder({
      operations: [
        ...this.state.operations,
        { type: 'LOAD', data: { __sparql: true, value: `<${url}>` }, graph, silent }
      ]
    })
  }

  /**
   * Clear a graph (remove all triples).
   * 
   * Removes all triples from the specified graph but keeps the graph itself.
   * Use 'DEFAULT' to clear the default graph.
   * 
   * @param graph Graph IRI or 'DEFAULT'
   * @param silent Don't fail if graph doesn't exist (default: false)
   * 
   * @example Clear default graph
   * ```ts
   * clear('DEFAULT')
   * ```
   * 
   * @example Clear named graph
   * ```ts
   * clear('http://example.org/graph1')
   * ```
   * 
   * @example Silent clear
   * ```ts
   * clear('http://example.org/graph1', true)
   * // Doesn't error if graph doesn't exist
   * ```
   */
  clear(graph: string, silent = false): UpdateBuilder {
    return new UpdateBuilder({
      operations: [
        ...this.state.operations,
        { type: 'CLEAR', graph, silent }
      ]
    })
  }

  /**
   * Drop a graph (delete it entirely).
   * 
   * Completely removes a graph and all its triples. Unlike clear(), which
   * empties the graph but keeps it, drop() removes the graph entirely.
   * 
   * @param graph Graph IRI to drop
   * @param silent Don't fail if graph doesn't exist (default: false)
   * 
   * @example Drop named graph
   * ```ts
   * drop('http://example.org/graph1')
   * ```
   * 
   * @example Silent drop
   * ```ts
   * drop('http://example.org/graph1', true)
   * // Succeeds even if graph doesn't exist
   * ```
   */
  drop(graph: string, silent = false): UpdateBuilder {
    return new UpdateBuilder({
      operations: [
        ...this.state.operations,
        { type: 'DROP', graph, silent }
      ]
    })
  }

  /**
   * Create a new empty graph.
   * 
   * Creates a new named graph. The graph starts empty - use insertData()
   * to add triples to it.
   * 
   * @param graph Graph IRI to create
   * @param silent Don't fail if graph already exists (default: false)
   * 
   * @example Create graph
   * ```ts
   * create('http://example.org/graph1')
   * ```
   * 
   * @example Silent create
   * ```ts
   * create('http://example.org/graph1', true)
   * // Succeeds even if graph already exists
   * ```
   */
  create(graph: string, silent = false): UpdateBuilder {
    return new UpdateBuilder({
      operations: [
        ...this.state.operations,
        { type: 'CREATE', graph, silent }
      ]
    })
  }

  /**
   * Copy all triples from one graph to another.
   * 
   * Copies the content of the source graph to the destination graph. The destination
   * graph is overwritten - any existing content in it is replaced. The source graph
   * remains unchanged.
   * 
   * Use 'DEFAULT' as the graph name to refer to the default graph.
   * 
   * @param source Source graph IRI (or 'DEFAULT')
   * @param dest Destination graph IRI (or 'DEFAULT')
   * @param silent Don't fail if source doesn't exist (default: false)
   * 
   * @example Copy to backup
   * ```ts
   * copy('http://example.org/graph1', 'http://example.org/backup1')
   * // Copies graph1 to backup1, replacing backup1's content
   * ```
   * 
   * @example Copy from default graph
   * ```ts
   * copy('DEFAULT', 'http://example.org/snapshot')
   * // Copies default graph to named graph
   * ```
   * 
   * @example Silent copy
   * ```ts
   * copy('http://example.org/source', 'http://example.org/dest', true)
   * // Succeeds even if source doesn't exist (dest becomes empty)
   * ```
   */
  copy(source: string, dest: string, silent = false): UpdateBuilder {
    return new UpdateBuilder({
      operations: [
        ...this.state.operations,
        { type: 'COPY', source, dest, silent }
      ]
    })
  }

  /**
   * Move all triples from one graph to another.
   * 
   * Moves the content of the source graph to the destination graph. The destination
   * graph is overwritten, and the source graph is cleared. This is equivalent to
   * COPY followed by DROP of the source.
   * 
   * Use 'DEFAULT' as the graph name to refer to the default graph.
   * 
   * @param source Source graph IRI (or 'DEFAULT')
   * @param dest Destination graph IRI (or 'DEFAULT')
   * @param silent Don't fail if source doesn't exist (default: false)
   * 
   * @example Rename graph
   * ```ts
   * move('http://example.org/temp', 'http://example.org/final')
   * // Moves temp to final, temp is left empty
   * ```
   * 
   * @example Archive to default
   * ```ts
   * move('http://example.org/staging', 'DEFAULT')
   * // Moves staging content to default graph, clears staging
   * ```
   * 
   * @example Silent move
   * ```ts
   * move('http://example.org/source', 'http://example.org/dest', true)
   * // Succeeds even if source doesn't exist
   * ```
   */
  move(source: string, dest: string, silent = false): UpdateBuilder {
    return new UpdateBuilder({
      operations: [
        ...this.state.operations,
        { type: 'MOVE', source, dest, silent }
      ]
    })
  }

  /**
   * Add all triples from one graph to another.
   * 
   * Adds the content of the source graph to the destination graph. Unlike COPY,
   * existing triples in the destination are preserved. The source graph remains
   * unchanged. This is like a merge operation.
   * 
   * Use 'DEFAULT' as the graph name to refer to the default graph.
   * 
   * @param source Source graph IRI (or 'DEFAULT')
   * @param dest Destination graph IRI (or 'DEFAULT')
   * @param silent Don't fail if source doesn't exist (default: false)
   * 
   * @example Merge graphs
   * ```ts
   * add('http://example.org/updates', 'http://example.org/main')
   * // Adds updates to main without removing existing main content
   * ```
   * 
   * @example Combine into default
   * ```ts
   * add('http://example.org/graph1', 'DEFAULT')
   * add('http://example.org/graph2', 'DEFAULT')
   * // Merges multiple graphs into default graph
   * ```
   * 
   * @example Silent add
   * ```ts
   * add('http://example.org/optional', 'http://example.org/main', true)
   * // Succeeds even if optional graph doesn't exist
   * ```
   */
  add(source: string, dest: string, silent = false): UpdateBuilder {
    return new UpdateBuilder({
      operations: [
        ...this.state.operations,
        { type: 'ADD', source, dest, silent }
      ]
    })
  }

  /**
   * Build the SPARQL Update request.
   * 
   * Converts all operations into a SPARQL Update string. Multiple operations
   * are separated by semicolons.
   * 
   * @returns SPARQL Update string wrapped in SparqlValue
   * 
   * @example
   * ```ts
   * const updateStr = update()
   *   .insertData(triple('ex:person1', 'foaf:name', str('Alice')))
   *   .build()
   * 
   * console.log(updateStr.value)
   * // INSERT DATA { ex:person1 foaf:name "Alice" . }
   * ```
   */
  build(): SparqlValue {
    const operations: string[] = []

    for (const op of this.state.operations) {
      const silent = op.silent ? 'SILENT ' : ''

      switch (op.type) {
        case 'INSERT_DATA': {
          const graphClause = op.graph ? `GRAPH <${op.graph}> ` : ''
          operations.push(`INSERT DATA { ${graphClause}${op.data!.value} }`)
          break
        }

        case 'DELETE_DATA': {
          const graphClause = op.graph ? `GRAPH <${op.graph}> ` : ''
          operations.push(`DELETE DATA { ${graphClause}${op.data!.value} }`)
          break
        }

        case 'DELETE_WHERE': {
          operations.push(`DELETE WHERE { ${op.where!.value} }`)
          break
        }

        case 'DELETE_INSERT': {
          const parts: string[] = []
          if (op.deleteTemplate) {
            parts.push(`DELETE { ${op.deleteTemplate.value} }`)
          }
          if (op.insertTemplate) {
            parts.push(`INSERT { ${op.insertTemplate.value} }`)
          }
          if (op.where) {
            parts.push(`WHERE { ${op.where.value} }`)
          }
          operations.push(parts.join('\n'))
          break
        }

        case 'LOAD': {
          const into = op.graph ? ` INTO GRAPH <${op.graph}>` : ''
          operations.push(`LOAD ${silent}${op.data!.value}${into}`)
          break
        }

        case 'CLEAR': {
          const target = op.graph === 'DEFAULT' ? 'DEFAULT' : `GRAPH <${op.graph}>`
          operations.push(`CLEAR ${silent}${target}`)
          break
        }

        case 'DROP': {
          const target = op.graph === 'DEFAULT' ? 'DEFAULT' : `GRAPH <${op.graph}>`
          operations.push(`DROP ${silent}${target}`)
          break
        }

        case 'CREATE': {
          operations.push(`CREATE ${silent}GRAPH <${op.graph}>`)
          break
        }

        case 'COPY': {
          const sourceRef = op.source === 'DEFAULT' ? 'DEFAULT' : `<${op.source}>`
          const destRef = op.dest === 'DEFAULT' ? 'DEFAULT' : `<${op.dest}>`
          operations.push(`COPY ${silent}${sourceRef} TO ${destRef}`)
          break
        }

        case 'MOVE': {
          const sourceRef = op.source === 'DEFAULT' ? 'DEFAULT' : `<${op.source}>`
          const destRef = op.dest === 'DEFAULT' ? 'DEFAULT' : `<${op.dest}>`
          operations.push(`MOVE ${silent}${sourceRef} TO ${destRef}`)
          break
        }

        case 'ADD': {
          const sourceRef = op.source === 'DEFAULT' ? 'DEFAULT' : `<${op.source}>`
          const destRef = op.dest === 'DEFAULT' ? 'DEFAULT' : `<${op.dest}>`
          operations.push(`ADD ${silent}${sourceRef} TO ${destRef}`)
          break
        }
      }
    }

    return sparql`${operations.join(';\n')}`
  }

  /**
   * Execute the update against an endpoint.
   * 
   * Builds the update and sends it to the endpoint's update endpoint.
   * Returns a result object indicating success or failure.
   * 
   * @param config Endpoint configuration
   * @returns Promise of update result
   * 
   * @example
   * ```ts
   * const result = await update()
   *   .insertData(triple('ex:person1', 'foaf:name', str('Alice')))
   *   .execute({
   *     endpoint: 'http://localhost:9999/sparql',
   *     updateEndpoint: 'http://localhost:9999/update'
   *   })
   * 
   * if (result.success) {
   *   console.log('Update succeeded')
   * } else {
   *   console.error(result.error.message)
   * }
   * ```
   */
  execute(config: ExecutorConfig): Promise<SparqlResult> {
    const executor = createExecutor(config)
    return executor(this.build())
  }
}

// ============================================================================
// Modify Builder
// ============================================================================

/**
 * Builder for DELETE/INSERT operations.
 * 
 * Created by calling modify() on an UpdateBuilder. Lets you specify delete
 * templates, insert templates, and where patterns. Call done() when finished
 * to return to the main UpdateBuilder.
 */
class ModifyBuilder {
  constructor(
    private readonly updateState: UpdateState,
    private readonly deleteTemplate?: SparqlValue,
    private readonly insertTemplate?: SparqlValue,
    private readonly wherePatterns: SparqlValue[] = []
  ) {}

  /**
   * Add DELETE template.
   * 
   * Specifies which triples to delete. Variables in the template are bound
   * by the WHERE clause, then those matched triples are deleted.
   * 
   * @param template Pattern of triples to delete
   * 
   * @example
   * ```ts
   * modify()
   *   .delete(triple('?person', 'foaf:age', '?age'))
   *   .where(triple('?person', 'foaf:age', '?age'))
   *   .done()
   * ```
   */
  delete(template: SparqlValue): ModifyBuilder {
    return new ModifyBuilder(
      this.updateState,
      template,
      this.insertTemplate,
      this.wherePatterns
    )
  }

  /**
   * Add INSERT template.
   * 
   * Specifies which triples to insert. Variables in the template are bound
   * by the WHERE clause, then those new triples are inserted.
   * 
   * @param template Pattern of triples to insert
   * 
   * @example
   * ```ts
   * modify()
   *   .insert(triple('?person', 'foaf:age', '?newAge'))
   *   .where(triple('?person', 'foaf:age', '?oldAge'))
   *   .where(bind(add(v('oldAge'), 1), 'newAge'))
   *   .done()
   * ```
   */
  insert(template: SparqlValue): ModifyBuilder {
    return new ModifyBuilder(
      this.updateState,
      this.deleteTemplate,
      template,
      this.wherePatterns
    )
  }

  /**
   * Add WHERE pattern.
   * 
   * Patterns that bind variables used in DELETE and INSERT templates.
   * Multiple where() calls are ANDed together.
   * 
   * @param pattern Pattern to match
   * 
   * @example
   * ```ts
   * modify()
   *   .delete(triple('?person', 'foaf:age', '?oldAge'))
   *   .insert(triple('?person', 'foaf:age', '?newAge'))
   *   .where(triple('?person', 'foaf:age', '?oldAge'))
   *   .where(filter(gte(v('oldAge'), 0)))
   *   .where(bind(add(v('oldAge'), 1), 'newAge'))
   *   .done()
   * ```
   */
  where(pattern: SparqlValue): ModifyBuilder {
    return new ModifyBuilder(
      this.updateState,
      this.deleteTemplate,
      this.insertTemplate,
      [...this.wherePatterns, pattern]
    )
  }

  /**
   * Finalize and return to UpdateBuilder.
   * 
   * Completes the DELETE/INSERT operation and returns to the main UpdateBuilder
   * so you can add more operations or execute.
   * 
   * @returns UpdateBuilder with this operation added
   * 
   * @example
   * ```ts
   * update()
   *   .modify()
   *     .delete(triple('?person', 'foaf:age', '?oldAge'))
   *     .insert(triple('?person', 'foaf:age', '?newAge'))
   *     .where(triple('?person', 'foaf:age', '?oldAge'))
   *     .where(bind(add(v('oldAge'), 1), 'newAge'))
   *   .done()  // Returns to UpdateBuilder
   *   .execute(config)
   * ```
   */
  done(): UpdateBuilder {
    const whereValue = this.wherePatterns.length > 0
      ? raw(this.wherePatterns.map(p => p.value).join('\n  '))
      : undefined

    return new UpdateBuilder({
      operations: [
        ...this.updateState.operations,
        {
          type: 'DELETE_INSERT',
          deleteTemplate: this.deleteTemplate,
          insertTemplate: this.insertTemplate,
          where: whereValue
        }
      ]
    })
  }
}

// ============================================================================
// Convenience Exports
// ============================================================================

/**
 * Start building an update operation.
 * 
 * Creates an empty UpdateBuilder you can add operations to. This is the
 * general entry point when you want to combine multiple operations.
 * 
 * @example
 * ```ts
 * update()
 *   .insertData(triple('ex:person1', 'foaf:name', str('Alice')))
 *   .insertData(triple('ex:person2', 'foaf:name', str('Bob')))
 *   .execute(config)
 * ```
 */
export const update = UpdateBuilder.create

/**
 * Start with INSERT DATA operation.
 * 
 * Convenience function for inserting triples. Equivalent to
 * update().insertData(...).
 * 
 * @param data Triples to insert
 * @param graph Optional named graph
 * 
 * @example
 * ```ts
 * insert(triples('ex:person1', [
 *   ['rdf:type', 'foaf:Person'],
 *   ['foaf:name', str('Alice')]
 * ]))
 *   .execute(config)
 * ```
 */
export function insert(data: SparqlValue, graph?: string): UpdateBuilder {
  return UpdateBuilder.create().insertData(data, graph)
}

/**
 * Start with DELETE DATA operation.
 * 
 * Convenience function for deleting triples. Equivalent to
 * update().deleteData(...).
 * 
 * @param data Triples to delete
 * @param graph Optional named graph
 * 
 * @example
 * ```ts
 * deleteOp(triple('ex:person1', 'foaf:age', num(30)))
 *   .execute(config)
 * ```
 */
export function deleteOp(data: SparqlValue, graph?: string): UpdateBuilder {
  return UpdateBuilder.create().deleteData(data, graph)
}

/**
 * Start with DELETE/INSERT operation.
 * 
 * Convenience function for conditional updates. Equivalent to
 * update().modify().
 * 
 * @example
 * ```ts
 * modify()
 *   .delete(triple('?person', 'foaf:age', '?oldAge'))
 *   .insert(triple('?person', 'foaf:age', '?newAge'))
 *   .where(triple('?person', 'foaf:age', '?oldAge'))
 *   .where(bind(add(v('oldAge'), 1), 'newAge'))
 *   .done()
 *   .execute(config)
 * ```
 */
export function modify(): ModifyBuilder {
  return UpdateBuilder.create().modify()
}