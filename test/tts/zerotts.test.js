'use strict'

const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')

module.exports = async function runZeroTTSTests(root) {
  console.log('  Running ZeroTTS Unit Tests...')

  const entryPath = path.join(root, 'dist', 'index.js')
  assert.ok(fs.existsSync(entryPath), 'dist/index.js must exist')

  // Test 1: Verify Voice Manifest & List
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'extension.json'), 'utf8'))
  assert.equal(manifest.name, 'zerotts-cpu-process')
  assert.equal(manifest.contributes.tts.mode, 'process')
  assert.ok(manifest.contributes.tts.resources.length >= 30, 'Must declare at least 30 resources')
  assert.ok(
    manifest.contributes.tts.resources
      .filter(r => r.path.startsWith('models/'))
      .every(r => r.url.startsWith('https://huggingface.co/haidv2806/zerotts-model/resolve/main/model/')),
    'All model resources must be downloaded from Hugging Face model repository'
  )

  // Test 2: Verify resources have valid SHA256 and valid URLs (file:// for local test, https:// for production)
  for (const res of manifest.contributes.tts.resources) {
    assert.ok(
      res.url.startsWith('file://') || res.url.startsWith('https://'),
      `Invalid resource URL: ${res.url}`
    )
    assert.ok(res.path.startsWith('models/') || res.path.startsWith('bin/'), `Invalid resource path: ${res.path}`)
    assert.ok(res.size > 0, `Invalid size for ${res.path}`)
    assert.match(res.sha256, /^[a-f0-9]{64}$/i, `Invalid sha256 for ${res.path}`)
  }

  // Test 3: Test model directory
  const modelDir = [
    path.join(root, 'model'),
    path.join(root, 'models')
  ].find(fs.existsSync)
  assert.ok(modelDir, 'model or models directory must exist')
  assert.ok(fs.existsSync(path.join(modelDir, 'config.json')), 'config.json must exist in model')
  assert.ok(fs.existsSync(path.join(modelDir, 'tokenizer.json')), 'tokenizer.json must exist in model')
  assert.ok(fs.existsSync(path.join(modelDir, 'voices', 'index.json')), 'voices/index.json must exist in model')

  // Test 4: Verify dist/browser.js executes without TypeError: require is not a function
  const browserBundlePath = path.join(root, 'dist', 'browser.js')
  assert.ok(fs.existsSync(browserBundlePath), 'dist/browser.js must exist')
  const vm = require('node:vm')
  const browserCode = fs.readFileSync(browserBundlePath, 'utf8')
  const sandboxContext = {
    console,
    module: { exports: {} },
    exports: {},
    require: {}, // Not a function!
    setTimeout,
    clearTimeout
  }
  assert.doesNotThrow(() => {
    vm.runInNewContext(browserCode, sandboxContext)
  }, 'dist/browser.js must not crash with TypeError: require is not a function')

  // Test 5: Verify BpeTokenizer pure-TS encoding & decoding
  const { BpeTokenizer, ZeroTTSEngine, createWavBuffer } = require(path.join(root, 'dist', 'index.js'))
  if (BpeTokenizer) {
    const rawTokenizer = JSON.parse(fs.readFileSync(path.join(modelDir, 'tokenizer.json'), 'utf8'))
    const tokenizer = await BpeTokenizer.create(rawTokenizer)
    const testText = 'Xin chào, đây là một thử nghiệm ZeroTTS.'
    const encoded = tokenizer.encode(testText)
    assert.equal(encoded[0], 1n, 'First token must be BOS (1)')
    assert.equal(encoded[encoded.length - 1], 2n, 'Last token must be EOT (2)')
    const decoded = tokenizer.decode(encoded)
    assert.equal(decoded, testText, 'Decoded text must match original')
  }

  // Test 6: Verify Sample Rate is 48000 Hz
  if (ZeroTTSEngine) {
    assert.equal(ZeroTTSEngine.SAMPLE_RATE, 48000, 'ZeroTTSEngine.SAMPLE_RATE must be 48000 Hz')
    const dummyAudio = new Float32Array(48000)
    const wavBytes = createWavBuffer(dummyAudio)
    const view = new DataView(wavBytes.buffer, wavBytes.byteOffset, wavBytes.byteLength)
    const sampleRate = view.getUint32(24, true)
    assert.equal(sampleRate, 48000, 'WAV header sample rate must be 48000 Hz')
  }

  // Test 7: Verify resolveVoiceId normalizes different voice representations
  if (ZeroTTSEngine) {
    const mockApi = { logger: { info: async () => {}, warn: async () => {}, error: async () => {} } }
    const engine = new ZeroTTSEngine(mockApi)
    assert.equal(engine.resolveVoiceId('maichi'), 'maichi')
    assert.equal(engine.resolveVoiceId('Mai Chi'), 'maichi')
    assert.equal(engine.resolveVoiceId('👩 Mai Chi (Nữ trẻ, kể chuyện nhẹ nhàng)'), 'maichi')
    assert.equal(engine.resolveVoiceId('baotrang'), 'baotrang')
    assert.equal(engine.resolveVoiceId('Bảo Trang'), 'baotrang')
    assert.equal(engine.resolveVoiceId('quangminh'), 'quangminh')
    assert.equal(engine.resolveVoiceId('Quang Minh'), 'quangminh')
    assert.equal(engine.resolveVoiceId('👨 Quang Minh (Nam trẻ, tin tức rõ ràng)'), 'quangminh')
    assert.equal(engine.resolveVoiceId('unknown_voice_random'), 'maichi', 'Should default to maichi')
    assert.equal(engine.resolveVoiceId(undefined), 'maichi')
  }

  // Test 8: Verify voice embeddings load distinctly for different voices
  if (ZeroTTSEngine) {
    const mockApi = { logger: { info: async () => {}, warn: async () => {}, error: async () => {} } }
    const engine = new ZeroTTSEngine(mockApi)
    const embMaichi = await engine.getVoiceEmbedding('maichi')
    const embQuangminh = await engine.getVoiceEmbedding('quangminh')
    assert.equal(embMaichi.length, 7680, 'maichi voice embedding must be 7680 floats')
    assert.equal(embQuangminh.length, 7680, 'quangminh voice embedding must be 7680 floats')
    let isDifferent = false
    for (let i = 0; i < embMaichi.length; i++) {
      if (embMaichi[i] !== embQuangminh[i]) {
        isDifferent = true
        break
      }
    }
    assert.ok(isDifferent, 'Voice embeddings for maichi and quangminh must be distinctly different')
  }

  console.log('  [PASS] All ZeroTTS Unit Tests passed successfully.')
}
