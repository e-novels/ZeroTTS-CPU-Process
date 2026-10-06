'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const runTTSContractTests = require('./contract.test')
const runCpuCoresTests = require('./cpu-cores.test')
const runZeroTTSTests = require('./zerotts.test')

module.exports = async function runTtsTests(root, manifest) {
  assert.equal(manifest.icon, './public/icon.png')
  assert.ok(manifest.permissions.includes('tts'))
  assert.equal(manifest.contributes?.scraper, undefined)
  assert.ok(manifest.contributes?.tts, 'TTS profile must contribute tts configuration')

  const ttsMode = manifest.contributes.tts.mode || 'process'

  async function smokeBundle(filename) {
    const entryPath = path.join(root, 'dist', filename)
    assert.ok(fs.existsSync(entryPath), `${filename} must be built before testing`)
    delete require.cache[require.resolve(entryPath)]
    const extension = require(entryPath)
    const logs = []
    let registeredTTS = null
    let spawnedProcess = null
    let lineListener = null

    const mockNovel = {
      version: '1.0.0',
      platform: 'darwin',
      extension: { id: manifest.name, manifest },
      logger: {
        info: async value => logs.push(value),
        warn: async () => undefined,
        error: async () => undefined
      },
      scraper: { register: async () => { throw new Error('TTS profile must not register a scraper.') } },
      settings: { register: async () => undefined },
      tts: {
        register: async handlers => {
          registeredTTS = handlers
        }
      },
      process: {
        spawn: async ({ executable }) => {
          spawnedProcess = executable
          return { success: true, processId: 'proc-mock-1' }
        },
        onLine: (processId, callback) => {
          if (processId === 'proc-mock-1') {
            lineListener = callback
          }
        },
        writeLine: async (processId, jsonStr) => {
          if (processId !== 'proc-mock-1') throw new Error('Unknown processId')
          const req = JSON.parse(jsonStr)
          let responsePayload
          if (req.method === 'getVoices') {
            responsePayload = {
              id: req.id,
              result: { voices: [{ id: 'mock-proc-voice', name: 'Mock Process Voice', lang: 'vi-VN' }] }
            }
          } else if (req.method === 'speak') {
            responsePayload = {
              id: req.id,
              result: { audio: 'RIFFmockaudio', mimeType: 'audio/wav' }
            }
          } else if (req.method === 'stop') {
            responsePayload = {
              id: req.id,
              result: { success: true }
            }
          } else {
            responsePayload = { id: req.id, error: 'Unknown method' }
          }
          if (lineListener) {
            setImmediate(() => lineListener(JSON.stringify(responsePayload)))
          }
        },
        kill: async processId => {
          if (processId === 'proc-mock-1') {
            spawnedProcess = null
            lineListener = null
          }
        }
      },
      network: {
        fetchJson: async () => ({ voices: [] }),
        fetchText: async () => ''
      },
      storage: {
        get: async key => (key.startsWith('models/') ? { name: path.basename(key) } : null),
        set: async () => undefined,
        remove: async () => undefined,
        createAssetUrl: async path => `novel-ext://mock-token/${path}`
      }
    }

    await extension.activate(mockNovel)

    assert.ok(registeredTTS !== null, 'TTS handlers should be registered')
    assert.equal(typeof registeredTTS.getVoices, 'function')
    assert.equal(typeof registeredTTS.speak, 'function')

    const getVoicesRes = await registeredTTS.getVoices()
    assert.ok(getVoicesRes && Array.isArray(getVoicesRes.voices), 'getVoices should return a voices array')
    assert.ok(getVoicesRes.voices.length > 0, 'voices array should not be empty')

    const speakRes = await registeredTTS.speak({ text: 'Xin chào', voiceId: getVoicesRes.voices[0].id })
    assert.ok(speakRes && typeof speakRes.audio === 'string', 'speak should return an audio string')
    assert.ok(speakRes.mimeType, 'speak should return a mimeType')

    if (typeof registeredTTS.stop === 'function') {
      const stopRes = await registeredTTS.stop()
      assert.ok(stopRes !== undefined)
    }

    await runTTSContractTests(root, manifest, registeredTTS)
    await extension.deactivate()
  }

  try {
    await runCpuCoresTests(root, manifest)
    await Promise.all([smokeBundle('index.js'), smokeBundle('browser.js')])
    await runZeroTTSTests(root)
    console.log(`[${manifest.displayName}] TTS (${ttsMode}) profile tests passed`)
  } catch (error) {
    console.error(error)
    process.exitCode = 1
  }
}
