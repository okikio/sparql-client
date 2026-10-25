/** Structural TypeScript module references for the core runtime dependency policy. @module */
import ts from 'typescript'
import { allowed } from './ownership.ts'
export { allowed } from './ownership.ts'

export interface ReferenceType {
  readonly kind: 'runtime' | 'type' | 'dynamic'
  readonly specifier?: string
}

/** Parses declarations and import expressions without treating comments or ordinary strings as code. */
export function references(source: string, fileName = 'policy.ts'): ReferenceType[] {
  const file = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  )
  // One owned source is enough for syntax diagnostics; dependency and standard-library resolution
  // would add unrelated IO and semantic errors to this lexical policy check.
  const host: ts.CompilerHost = {
    getSourceFile: () => file,
    getDefaultLibFileName: () => '',
    writeFile: () => {},
    getCurrentDirectory: () => '/',
    getDirectories: () => [],
    fileExists: () => true,
    readFile: () => source,
    getCanonicalFileName: (name) => name,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => '\n',
  }
  const program = ts.createProgram([fileName], { noLib: true, noResolve: true, types: [] }, host)
  if (program.getSyntacticDiagnostics(file).length) {
    throw new TypeError(
      `${fileName}: dependency inspection requires syntactically valid TypeScript.`,
    )
  }
  const result: ReferenceType[] = []
  function visit(node: ts.Node): void {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const clause = node.importClause
      const bindings = clause?.namedBindings
      const type = clause?.isTypeOnly ||
        (!clause?.name && bindings && ts.isNamedImports(bindings) &&
          bindings.elements.length > 0 && bindings.elements.every((item) => item.isTypeOnly))
      result.push({ kind: type ? 'type' : 'runtime', specifier: node.moduleSpecifier.text })
    } else if (
      ts.isExportDeclaration(node) && node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      const type = node.isTypeOnly || (node.exportClause && ts.isNamedExports(node.exportClause) &&
        node.exportClause.elements.length > 0 && node.exportClause.elements.every((item) =>
          item.isTypeOnly
        ))
      result.push({ kind: type ? 'type' : 'runtime', specifier: node.moduleSpecifier.text })
    } else if (
      ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)
    ) {
      const expression = node.moduleReference.expression
      result.push({
        kind: node.isTypeOnly ? 'type' : 'runtime',
        ...(expression && ts.isStringLiteral(expression) ? { specifier: expression.text } : {}),
      })
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const value = node.arguments[0]
      result.push({
        kind: 'dynamic',
        ...(value && (ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value))
          ? { specifier: value.text }
          : {}),
      })
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  return result
}

/** Type-only references are erased; all dynamic imports are prohibited even with computed operands. */
export function dependencyErrors(source: string, fileName = 'policy.ts'): string[] {
  return references(source, fileName).flatMap((reference) => {
    if (reference.kind === 'type') return []
    if (reference.kind === 'dynamic') {
      return ['dynamic imports are not allowed in the core production graph']
    }
    return reference.specifier && allowed(reference.specifier, fileName)
      ? []
      : [`core runtime import '${reference.specifier ?? '(unknown)'}' is not allowed`]
  })
}
