const path = require('node:path')
const fs = require('node:fs')
const crypto = require('node:crypto')
const AdmZip = require('adm-zip')

const root = __dirname
const manifestPath = path.join(root, 'extension.json')
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))

// Synchronize SHA-256 and file sizes of bin/server and bin/server.bat in manifest resources
if (manifest.contributes?.tts?.resources) {
  for (const res of manifest.contributes.tts.resources) {
    const localFile = path.join(root, res.path)
    if (fs.existsSync(localFile)) {
      const buf = fs.readFileSync(localFile)
      res.size = buf.length
      res.sha256 = crypto.createHash('sha256').update(buf).digest('hex')
    }
  }
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
}

const archiveName = `${manifest.name}-${manifest.version}.zip`
const archive = new AdmZip()

function requirePackagedAsset(relativePath, field) {
	if (typeof relativePath !== 'string' || !relativePath) {
		throw new Error(`${field} must be a non-empty relative path.`)
	}
	const normalized = relativePath.replace(/\\/g, '/')
	if (normalized.includes('..') || normalized.startsWith('/')) {
		throw new Error(`${field} must be a safe relative path.`)
	}
	const assetPath = [
		path.join(root, normalized),
		path.join(root, 'src', normalized)
	].find(fs.existsSync)
	if (!assetPath) throw new Error(`${field} does not exist: ${relativePath}`)
	archive.addLocalFile(assetPath, path.dirname(normalized))
}

archive.addLocalFile(manifestPath)
archive.addLocalFile(path.join(root, 'README.md'))
archive.addLocalFolder(path.join(root, 'dist'), 'dist')
archive.addLocalFolder(path.join(root, 'src', 'public'), 'public')

if (fs.existsSync(path.join(root, 'bin'))) {
	archive.addLocalFolder(path.join(root, 'bin'), 'bin')
}
if (fs.existsSync(path.join(root, 'node_modules', 'onnxruntime-node'))) {
	archive.addLocalFolder(path.join(root, 'node_modules', 'onnxruntime-node'), 'node_modules/onnxruntime-node')
}

requirePackagedAsset(manifest.icon, 'icon')

for (const [index, theme] of (manifest.contributes?.themes || []).entries()) {
	requirePackagedAsset(theme.path, `contributes.themes[${index}].path`)
}

archive.writeZip(path.join(root, archiveName))

const archivePath = path.join(root, archiveName)
const sizeKilobytes = (fs.statSync(archivePath).size / 1024).toFixed(1)
console.log(`[${manifest.displayName || manifest.name}] Created ${archiveName} (${sizeKilobytes} KB)`)
