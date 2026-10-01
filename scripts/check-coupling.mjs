import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import ts from 'typescript'

const root = process.cwd()
const config = ts.readConfigFile('tsconfig.json', ts.sys.readFile)
if (config.error) throw new Error('Cannot read tsconfig for coupling checks')
const options = ts.parseJsonConfigFileContent(config.config, ts.sys, root).options
options.module = ts.ModuleKind.ESNext
const relative = (file) => path.relative(root, file).replaceAll('\\', '/')
const files = []
function walk(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name)
    if (entry.isDirectory()) walk(file)
    else if (/\.tsx?$/.test(file) && !/\.(test|spec)\.|\.d\.ts$/.test(file)) files.push(file)
  }
}
walk(path.join(root, 'src'))

const graph = new Map()
const violations = []
function imports(source, file) {
  return source.statements.flatMap((node) => {
    if (!ts.isImportDeclaration(node) && !ts.isExportDeclaration(node)) return []
    if (!node.moduleSpecifier || !ts.isStringLiteral(node.moduleSpecifier)) return []
    const target = ts.resolveModuleName(node.moduleSpecifier.text, file, options, ts.sys)
      .resolvedModule?.resolvedFileName
    return target && relative(target).startsWith('src/') ? [relative(target)] : []
  })
}

for (const file of files) {
  const name = relative(file)
  const text = readFileSync(file, 'utf8')
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true)
  for (const target of imports(source, file)) {
    if (name.startsWith('src/domain/') && /^src\/(server|db|app|components)\//.test(target)) {
      violations.push(`${name} depends on ${target}; domain contracts must stay independent`)
    }
    if (
      name.startsWith('src/server/guardrails/') &&
      (target.startsWith('src/db/') ||
        /^src\/server\/search\/repository(?:-postgres)?\.ts$/.test(target))
    ) {
      violations.push(`${name} depends on ${target}; guardrails must use the budget port`)
    }
  }
  // Inspect emitted imports so erased type dependencies cannot create false runtime cycles.
  const emitted = ts.transpileModule(text, { compilerOptions: options, fileName: file }).outputText
  const runtime = ts.createSourceFile(
    file + '.js',
    emitted,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  )
  graph.set(name, imports(runtime, file))
}

const visiting = new Set()
const visited = new Set()
function visit(file, stack = []) {
  if (visiting.has(file)) {
    violations.push(`Runtime cycle: ${[...stack.slice(stack.indexOf(file)), file].join(' -> ')}`)
    return
  }
  if (visited.has(file)) return
  visiting.add(file)
  for (const target of graph.get(file) || []) visit(target, [...stack, file])
  visiting.delete(file)
  visited.add(file)
}
for (const file of graph.keys()) visit(file)

if (violations.length) {
  for (const violation of violations) console.error(violation)
  process.exit(1)
}
const edges = [...graph.values()].reduce((sum, targets) => sum + targets.length, 0)
console.log(
  `Coupling checks passed: ${graph.size} production modules, ${edges} runtime edges; no cycles or boundary violations`,
)
