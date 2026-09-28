import ts from 'typescript'
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
for (const root of ['src/lib', 'src/utils', 'api']) {
  for (const file of readdirSync(root)) {
    if (!file.endsWith('.ts')) continue
    const source = join(root, file),
      destination = join('.test-build', source.replace(/\.ts$/, '.js'))
    mkdirSync(dirname(destination), { recursive: true })
    const result = ts
      .transpileModule(readFileSync(source, 'utf8'), {
        compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext },
      })
      .outputText.replace(
        /(from\s+['"])(\.[^'"]+)(['"])/g,
        (_, prefix, path, suffix) => prefix + (path.endsWith('.js') ? path : path + '.js') + suffix
      )
    writeFileSync(destination, result)
  }
}
