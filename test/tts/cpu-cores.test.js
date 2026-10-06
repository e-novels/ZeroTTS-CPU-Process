'use strict'

const assert = require('node:assert/strict')
const os = require('node:os')
const fs = require('node:fs')
const path = require('node:path')

module.exports = async function runCpuCoresTests(root, manifest) {
  console.log('  Running CPU Core & Threading Optimization Tests...')

  const entryPath = path.join(root, 'dist', 'index.js')
  const { CPU_COUNT, getOptimalCpuThreads, ZeroTTSEngine } = require(entryPath)

  // 1. Verify CPU_COUNT detection
  const expectedCores = os.availableParallelism ? os.availableParallelism() : os.cpus().length
  assert.equal(typeof CPU_COUNT, 'number', 'CPU_COUNT must be a number')
  assert.equal(CPU_COUNT, expectedCores, `CPU_COUNT should match available parallelism (${expectedCores})`)
  assert.ok(CPU_COUNT >= 1, 'CPU_COUNT must be at least 1')

  // 2. Verify getOptimalCpuThreads returns all cores by default (100% capacity)
  assert.equal(getOptimalCpuThreads(), CPU_COUNT, 'getOptimalCpuThreads() must default to all available cores (100% CPU)')
  assert.equal(getOptimalCpuThreads('auto'), CPU_COUNT, 'getOptimalCpuThreads("auto") must default to all available cores')
  assert.equal(getOptimalCpuThreads('8'), 8, 'getOptimalCpuThreads("8") should parse string')
  assert.equal(getOptimalCpuThreads(12), 12, 'getOptimalCpuThreads(12) should accept number')

  // Test environment variable override
  const origEnv = process.env.ZEROTTS_THREADS
  try {
    process.env.ZEROTTS_THREADS = '16'
    assert.equal(getOptimalCpuThreads(), 16, 'getOptimalCpuThreads() should honor ZEROTTS_THREADS env var')
  } finally {
    if (origEnv !== undefined) {
      process.env.ZEROTTS_THREADS = origEnv
    } else {
      delete process.env.ZEROTTS_THREADS
    }
  }

  // 3. Verify manifest declarations
  const settingsFields = manifest.contributes?.settings?.fields || []
  const cpuThreadsField = settingsFields.find(f => f.id === 'cpuThreads')
  assert.ok(cpuThreadsField, 'extension.json settings must declare "cpuThreads" field')
  assert.equal(cpuThreadsField.type, 'select', 'cpuThreads must be a select field')
  assert.equal(cpuThreadsField.defaultValue, 'auto', 'cpuThreads defaultValue must be "auto" for 100% core usage')

  const previewAction = manifest.contributes?.settings?.actions?.find(a => a.id === 'previewVoice')
  assert.ok(previewAction, 'previewVoice action must exist')
  assert.ok(previewAction.fields.includes('cpuThreads'), 'previewVoice action must include cpuThreads in its fields')

  // 4. Verify bin/server scripts configure OpenMP environment variables and NODE_PATH
  const binServer = fs.readFileSync(path.join(root, 'bin', 'server'), 'utf8')
  assert.ok(binServer.includes('OMP_WAIT_POLICY=PASSIVE'), 'bin/server must configure OMP_WAIT_POLICY')
  assert.ok(binServer.includes('KMP_BLOCKTIME=0'), 'bin/server must configure KMP_BLOCKTIME')
  assert.ok(binServer.includes('NODE_PATH'), 'bin/server must configure NODE_PATH')

  const binServerBat = fs.readFileSync(path.join(root, 'bin', 'server.bat'), 'utf8')
  assert.ok(binServerBat.includes('OMP_WAIT_POLICY=PASSIVE'), 'bin/server.bat must configure OMP_WAIT_POLICY')
  assert.ok(binServerBat.includes('KMP_BLOCKTIME=0'), 'bin/server.bat must configure KMP_BLOCKTIME')
  assert.ok(binServerBat.includes('NODE_PATH'), 'bin/server.bat must configure NODE_PATH')

  // 5. Verify ZeroTTSEngine single-flight initialization
  const mockNovel = {
    version: '1.0.0',
    platform: 'darwin',
    extension: { id: 'zerotts-test' },
    logger: { info: async () => {}, warn: async () => {}, error: async () => {} },
    storage: null
  }
  const engine = new ZeroTTSEngine(mockNovel)
  const p1 = engine.initialize()
  const p2 = engine.initialize()
  assert.equal(p1, p2, 'Multiple initialize calls before resolution must return the identical Promise (no double allocation)')
  await p1

  console.log('  [PASS] All CPU Core & Multi-Threading Optimization Tests passed successfully.')
}
