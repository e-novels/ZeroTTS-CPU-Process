'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const AdmZip = require('adm-zip')

const root = path.join(__dirname, '..')
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'extension.json'), 'utf8'))
const archivePath = path.join(root, `${manifest.name}-${manifest.version}.zip`)

assert.ok(fs.existsSync(archivePath), 'Package archive must exist before verification')

const archive = new AdmZip(archivePath)
const entries = archive.getEntries().map(entry => entry.entryName).sort()

function toArchivePath(relativePath, field) {
  assert.equal(typeof relativePath, 'string', `${field} must be a string`)
  const normalized = relativePath.replace(/\\/g, '/').replace(/^\.\//, '')
  assert.ok(normalized && !normalized.startsWith('/') && !normalized.includes('..'), `${field} must be a safe relative path`)
  return normalized
}

const expectedEntries = new Set([
  'README.md',
  'extension.json',
  toArchivePath(manifest.main, 'main'),
  toArchivePath(manifest.browser, 'browser'),
  toArchivePath(manifest.icon, 'icon')
])

for (const [index, theme] of (manifest.contributes?.themes || []).entries()) {
  expectedEntries.add(toArchivePath(theme.path, `contributes.themes[${index}].path`))
}

if (fs.existsSync(path.join(root, 'dist/server.js'))) {
  expectedEntries.add('dist/server.js')
}
if (fs.existsSync(path.join(root, 'dist/ort-wasm-simd-threaded.wasm'))) {
  expectedEntries.add('dist/ort-wasm-simd-threaded.wasm')
}

function scanDir(dir, prefix) {
  if (!fs.existsSync(dir)) return
  for (const item of fs.readdirSync(dir).sort()) {
    const full = path.join(dir, item)
    const p = `${prefix}/${item}`
    if (fs.statSync(full).isDirectory()) {
      expectedEntries.add(`${p}/`)
      scanDir(full, p)
    } else {
      expectedEntries.add(p)
    }
  }
}

scanDir(path.join(root, 'bin'), 'bin')
scanDir(path.join(root, 'node_modules', 'onnxruntime-node'), 'node_modules/onnxruntime-node')

assert.deepEqual(entries, [...expectedEntries].sort())
assert.equal(entries.includes('manifest.json'), false)

console.log(`[${manifest.displayName}] Package archive verified successfully!`)
