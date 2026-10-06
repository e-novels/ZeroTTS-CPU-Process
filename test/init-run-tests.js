'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { initialize, parseOptions } = require('../init')

const root = path.join(__dirname, '..')
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'enovel-extension-init-'))

function createTemplate(target) {
  fs.mkdirSync(path.join(target, 'src', 'scraper'), { recursive: true })
  fs.mkdirSync(path.join(target, 'src', 'theme'), { recursive: true })
  fs.mkdirSync(path.join(target, 'src', 'translator'), { recursive: true })
  fs.mkdirSync(path.join(target, 'src', 'tts'), { recursive: true })
  fs.mkdirSync(path.join(target, 'src', 'tts', 'processMode'), { recursive: true })
  fs.mkdirSync(path.join(target, 'src', 'tts', 'cloudMode'), { recursive: true })
  fs.mkdirSync(path.join(target, 'src', 'tts', 'wasmMode'), { recursive: true })
  fs.mkdirSync(path.join(target, 'src', 'tts', 'python'), { recursive: true })
  fs.mkdirSync(path.join(target, 'src', 'types'), { recursive: true })
  fs.mkdirSync(path.join(target, 'test', 'theme'), { recursive: true })
  fs.mkdirSync(path.join(target, 'test', 'translator'), { recursive: true })
  fs.mkdirSync(path.join(target, 'test', 'tts'), { recursive: true })
  fs.mkdirSync(path.join(target, 'test', 'scraper'), { recursive: true })

  const baseManifest = JSON.parse(fs.readFileSync(path.join(root, 'extension.json'), 'utf8'))
  baseManifest.name = 'example-extension'
  fs.writeFileSync(path.join(target, 'extension.json'), JSON.stringify(baseManifest, null, 2))
  if (fs.existsSync(path.join(root, 'src', 'scraper', 'index.ts'))) {
    fs.copyFileSync(path.join(root, 'src', 'scraper', 'index.ts'), path.join(target, 'src', 'scraper', 'index.ts'))
  } else {
    fs.writeFileSync(path.join(target, 'src', 'scraper', 'index.ts'), "const BASE_URL = 'https://example.com'\n")
  }
  fs.copyFileSync(path.join(root, 'src', 'tts', 'index.ts'), path.join(target, 'src', 'tts', 'index.ts'))
  fs.writeFileSync(path.join(target, 'src', 'types', 'scraper.d.ts'), '')
  fs.writeFileSync(path.join(target, 'src', 'types', 'theme.d.ts'), '')
  fs.writeFileSync(path.join(target, 'src', 'types', 'translator.d.ts'), '')
  fs.writeFileSync(path.join(target, 'src', 'types', 'tts.d.ts'), '')
}

try {
  const scraperRoot = path.join(tempRoot, 'scraper')
  createTemplate(scraperRoot)
  const scraper = initialize(scraperRoot, parseOptions([
    '--name', 'library-source',
    '--display-name', 'Library Source',
    '--publisher', 'independent-dev',
    '--kind', 'scraper',
    '--base-url', 'https://books.example.org/'
  ]))
  assert.equal(scraper.name, 'library-source')
  assert.deepEqual(scraper.network.allowedHosts, ['books.example.org'])
  assert.equal(scraper.contributes.scraper.site.baseUrl, 'https://books.example.org')
  assert.match(fs.readFileSync(path.join(scraperRoot, 'src', 'scraper', 'index.ts'), 'utf8'), /https:\/\/books\.example\.org/)
  assert.equal(fs.existsSync(path.join(scraperRoot, 'src', 'theme')), false)
  assert.equal(fs.existsSync(path.join(scraperRoot, 'src', 'translator')), false)
  assert.equal(fs.existsSync(path.join(scraperRoot, 'src', 'tts')), false)
  assert.equal(fs.existsSync(path.join(scraperRoot, 'src', 'types', 'theme.d.ts')), false)
  assert.equal(fs.existsSync(path.join(scraperRoot, 'src', 'types', 'translator.d.ts')), false)
  assert.equal(fs.existsSync(path.join(scraperRoot, 'src', 'types', 'tts.d.ts')), false)
  assert.equal(fs.existsSync(path.join(scraperRoot, 'test', 'theme')), false)
  assert.match(fs.readFileSync(path.join(scraperRoot, 'src', 'index.ts'), 'utf8'), /activateScraper/)

  assert.throws(() => initialize(scraperRoot, parseOptions([
    '--name', 'other-source', '--display-name', 'Other Source', '--publisher', 'independent-dev', '--kind', 'theme'
  ])), /Refusing to replace/)
  assert.throws(() => initialize(scraperRoot, parseOptions([
    '--name', 'unsafe-source', '--display-name', 'Unsafe Source', '--publisher', 'independent-dev', '--kind', 'scraper',
    '--base-url', 'https://reader:secret@books.example.org'
  ])), /must not include credentials/)
  assert.throws(() => initialize(scraperRoot, parseOptions([
    '--name', 'local-source', '--display-name', 'Local Source', '--publisher', 'independent-dev', '--kind', 'scraper',
    '--base-url', 'http://127.0.0.1:8080'
  ])), /must not use localhost or a private network address/)

  const themeRoot = path.join(tempRoot, 'theme')
  createTemplate(themeRoot)
  const theme = initialize(themeRoot, parseOptions([
    '--name', 'paper-theme',
    '--display-name', 'Paper Theme',
    '--publisher', 'independent-dev',
    '--kind', 'theme'
  ]))
  assert.deepEqual(theme.permissions, ['ui.theme'])
  assert.deepEqual(theme.contributes, {})
  assert.equal(theme.network, undefined)
  assert.equal(fs.existsSync(path.join(themeRoot, 'src', 'scraper')), false)
  assert.equal(fs.existsSync(path.join(themeRoot, 'src', 'types', 'scraper.d.ts')), false)
  assert.equal(fs.existsSync(path.join(themeRoot, 'test', 'scraper')), false)
  assert.match(fs.readFileSync(path.join(themeRoot, 'src', 'index.ts'), 'utf8'), /activateTheme/)


  const translatorRoot = path.join(tempRoot, 'translator')
  createTemplate(translatorRoot)
  const translator = initialize(translatorRoot, parseOptions([
    '--name', 'ai-translator',
    '--display-name', 'AI Translator',
    '--publisher', 'independent-dev',
    '--kind', 'translator'
  ]))
  assert.deepEqual(translator.permissions, ['translate', 'network', 'storage'])
  assert.equal(translator.contributes.translator.name, 'AI Translator')
  assert.deepEqual(translator.contributes.translator.targetLanguages, ['en', 'vi'])
  assert.equal(fs.existsSync(path.join(translatorRoot, 'src', 'scraper')), false)
  assert.equal(fs.existsSync(path.join(translatorRoot, 'src', 'types', 'scraper.d.ts')), false)
  assert.match(fs.readFileSync(path.join(translatorRoot, 'src', 'index.ts'), 'utf8'), /registerTranslatorProfile/)

  const ttsProcessRoot = path.join(tempRoot, 'tts-process')
  createTemplate(ttsProcessRoot)
  const ttsProcess = initialize(ttsProcessRoot, parseOptions([
    '--name', 'my-tts-service',
    '--display-name', 'My TTS Service',
    '--publisher', 'independent-dev',
    '--kind', 'tts',
    '--tts-mode', 'process'
  ]))
  assert.deepEqual(ttsProcess.permissions, ['tts', 'storage'])
  assert.equal(ttsProcess.contributes.tts.mode, 'process')
  assert.deepEqual(ttsProcess.contributes.tts.capabilities, ['getVoices', 'speak', 'stop'])
  assert.equal(fs.existsSync(path.join(ttsProcessRoot, 'src', 'theme')), false)
  assert.equal(fs.existsSync(path.join(ttsProcessRoot, 'src', 'types', 'theme.d.ts')), false)
  assert.equal(fs.existsSync(path.join(ttsProcessRoot, 'src', 'tts', 'processMode')), true)
  assert.equal(fs.existsSync(path.join(ttsProcessRoot, 'src', 'tts', 'python')), true)
  assert.equal(fs.existsSync(path.join(ttsProcessRoot, 'src', 'tts', 'cloudMode')), false)
  assert.equal(fs.existsSync(path.join(ttsProcessRoot, 'src', 'tts', 'wasmMode')), false)
  assert.match(fs.readFileSync(path.join(ttsProcessRoot, 'src', 'tts', 'index.ts'), 'utf8'), /ProcessBridge/)
  assert.match(fs.readFileSync(path.join(ttsProcessRoot, 'src', 'index.ts'), 'utf8'), /activateTTS/)

  const ttsCloudRoot = path.join(tempRoot, 'tts-cloud')
  createTemplate(ttsCloudRoot)
  const ttsCloud = initialize(ttsCloudRoot, parseOptions([
    '--name', 'my-cloud-tts',
    '--display-name', 'My Cloud TTS',
    '--publisher', 'independent-dev',
    '--kind', 'tts',
    '--tts-mode', 'cloud'
  ]))
  assert.deepEqual(ttsCloud.permissions, ['tts', 'network', 'storage'])
  assert.equal(ttsCloud.contributes.tts.mode, 'cloud')
  assert.equal(fs.existsSync(path.join(ttsCloudRoot, 'src', 'tts', 'cloudMode')), true)
  assert.equal(fs.existsSync(path.join(ttsCloudRoot, 'src', 'tts', 'processMode')), false)
  assert.equal(fs.existsSync(path.join(ttsCloudRoot, 'src', 'tts', 'python')), false)
  assert.equal(fs.existsSync(path.join(ttsCloudRoot, 'src', 'tts', 'wasmMode')), false)
  assert.match(fs.readFileSync(path.join(ttsCloudRoot, 'src', 'tts', 'index.ts'), 'utf8'), /CloudBridge/)

  const ttsWasmRoot = path.join(tempRoot, 'tts-wasm')
  createTemplate(ttsWasmRoot)
  const ttsWasm = initialize(ttsWasmRoot, parseOptions([
    '--name', 'my-wasm-tts',
    '--display-name', 'My WASM TTS',
    '--publisher', 'independent-dev',
    '--kind', 'tts',
    '--tts-mode', 'wasm'
  ]))
  assert.deepEqual(ttsWasm.permissions, ['tts', 'storage'])
  assert.equal(ttsWasm.contributes.tts.mode, 'wasm')
  assert.equal(fs.existsSync(path.join(ttsWasmRoot, 'src', 'tts', 'wasmMode')), true)
  assert.equal(fs.existsSync(path.join(ttsWasmRoot, 'src', 'tts', 'processMode')), false)
  assert.equal(fs.existsSync(path.join(ttsWasmRoot, 'src', 'tts', 'python')), false)
  assert.equal(fs.existsSync(path.join(ttsWasmRoot, 'src', 'tts', 'cloudMode')), false)
  assert.match(fs.readFileSync(path.join(ttsWasmRoot, 'src', 'tts', 'index.ts'), 'utf8'), /WasmBridge/)

  console.log('Initializer tests passed')
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true })
}