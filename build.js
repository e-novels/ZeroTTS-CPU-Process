const path = require('node:path')
const fs = require('node:fs')
const { build, context } = require('esbuild')

const root = __dirname
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'extension.json'), 'utf8'))
const extensionKind = manifest.starter?.kind
const isWatch = process.argv.includes('--watch') || process.argv.includes('-w')

// Ensure bin/server is executable on Unix systems
const binServer = path.join(root, 'bin', 'server')
if (fs.existsSync(binServer)) {
  try {
    fs.chmodSync(binServer, 0o755)
  } catch {}
}

async function bundle(entryPoint, outfile, platform) {
  const options = {
    entryPoints: [path.join(root, entryPoint)],
    outfile: path.join(root, outfile),
    bundle: true,
    format: 'cjs',
    platform: platform,
    mainFields: ['main'],
    target: 'es2022',
    legalComments: 'none',
    minify: false,
    define: {
      __NOVEL_EXTENSION_KIND__: JSON.stringify(extensionKind)
    },
    alias: {
      'onnxruntime-web': path.resolve(root, 'node_modules/onnxruntime-web/dist/ort.wasm.bundle.min.mjs')
    },
    external: ['onnxruntime-node']
  }

  if (isWatch) {
    const ctx = await context(options)
    await ctx.watch()
    console.log(`[esbuild watch] Watching ${outfile} for changes...`)
  } else {
    await build(options)
  }
}

Promise.all([
  bundle('src/index.ts', 'dist/index.js', 'node'),
  bundle('src/index.ts', 'dist/browser.js', 'browser'),
  bundle('src/tts/processMode/server.ts', 'dist/server.js', 'node')
]).catch(error => {
  console.error(error)
  process.exitCode = 1
})
