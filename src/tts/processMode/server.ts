import * as readline from 'node:readline'
import * as os from 'node:os'
import { ZeroTTSEngine, CPU_COUNT, getOptimalCpuThreads } from '../engine/ZeroTTSEngine'
import { createWavBase64 } from '../engine/wavHelper'

// Set OpenMP / multi-threading environment variables before ONNX runtime loads
const availableCores = os.availableParallelism?.() || os.cpus()?.length || 4
if (!process.env.OMP_NUM_THREADS) process.env.OMP_NUM_THREADS = String(availableCores)
if (!process.env.OMP_WAIT_POLICY) process.env.OMP_WAIT_POLICY = 'PASSIVE'
if (!process.env.KMP_BLOCKTIME) process.env.KMP_BLOCKTIME = '0'
if (!process.env.ORT_NUM_THREADS) process.env.ORT_NUM_THREADS = String(availableCores)

const mockNovel: any = {
  version: '1.0.0',
  platform: process.platform,
  extension: { id: 'zerotts-cpu-process' },
  logger: {
    info: async (...args: any[]) => console.error('[ZeroTTS Server INFO]', ...args),
    warn: async (...args: any[]) => console.error('[ZeroTTS Server WARN]', ...args),
    error: async (...args: any[]) => console.error('[ZeroTTS Server ERROR]', ...args),
  },
}

const engine = new ZeroTTSEngine(mockNovel)
let activeRequests = 0
let stdinClosed = false

function sendResponse(
  resp: { id?: string; result?: unknown; error?: string },
  callback?: () => void
): void {
  const jsonStr = JSON.stringify(resp) + '\n'
  const canContinue = process.stdout.write(jsonStr, () => {
    callback?.()
  })
  if (!canContinue && callback) {
    process.stdout.once('drain', callback)
  }
}

async function handleLine(line: string): Promise<void> {
  const trimmed = line.trim()
  if (!trimmed) return

  let request: any
  try {
    request = JSON.parse(trimmed)
  } catch (e: any) {
    console.error('[ZeroTTS Server] Failed to parse input JSON:', trimmed)
    return
  }

  const { id, method, params } = request
  activeRequests++

  const finishRequest = (resp: any) => {
    sendResponse(resp, () => {
      activeRequests--
      if (stdinClosed && activeRequests <= 0) {
        console.error('[ZeroTTS Server] All pending requests completed and flushed, exiting.')
        process.exit(0)
      }
    })
  }

  try {
    if (method === 'getVoices') {
      await engine.initialize()
      const voicesRes = engine.getVoices()
      finishRequest({ id, result: voicesRes })
    } else if (method === 'speak') {
      await engine.initialize()
      const text = params?.text || ''
      const voiceId = params?.voiceId || params?.config?.voice || 'maichi'
      const resolvedVoice = engine.resolveVoiceId(voiceId)
      const config = params?.config || {}
      const cpuThreads = config.cpuThreads ?? 'auto'

      const temperature = typeof config.temperature === 'number' ? config.temperature : 0.8
      const audioRepetitionPenalty =
        typeof config.audioRepetitionPenalty === 'number' ? config.audioRepetitionPenalty : 1.2
      const cfgScale = typeof config.cfgScale === 'number' ? config.cfgScale : 1.0

      const startTime = Date.now()
      const audioPcm = await engine.synthesize(text, resolvedVoice, {
        audioTemperature: temperature,
        audioRepetitionPenalty,
        cfgScale,
        cpuThreads,
      })

      const base64Audio = createWavBase64(audioPcm, ZeroTTSEngine.SAMPLE_RATE)
      const elapsed = Date.now() - startTime
      console.error(
        `[ZeroTTS Server] Synthesized ${audioPcm.length} samples (${(
          audioPcm.length / ZeroTTSEngine.SAMPLE_RATE
        ).toFixed(2)}s) in ${elapsed}ms (Multi-core Threads: ${getOptimalCpuThreads(cpuThreads)}/${availableCores})`
      )

      finishRequest({
        id,
        result: {
          audio: base64Audio,
          mimeType: 'audio/wav',
        },
      })
    } else if (method === 'stop') {
      finishRequest({ id, result: { success: true } })
    } else {
      throw new Error(`Unknown method: ${method}`)
    }
  } catch (err: any) {
    const errMsg = err instanceof Error ? err.message : String(err)
    console.error(`[ZeroTTS Server] Error executing ${method}:`, errMsg)
    finishRequest({ id, error: errMsg })
  }
}

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false,
})

rl.on('line', (line: string) => {
  handleLine(line).catch((err) => {
    console.error('[ZeroTTS Server] Unhandled error in line handler:', err)
  })
})

rl.on('close', () => {
  stdinClosed = true
  console.error('[ZeroTTS Server] Stdin closed.')
  if (activeRequests <= 0) {
    process.exit(0)
  }
})

// Pre-warm engine models asynchronously in background
engine.initialize().then(() => {
  console.error(
    `[ZeroTTS Server] ZeroTTS CPU Engine successfully pre-warmed across all ${availableCores} cores (100% multi-core ready).`
  )
}).catch((err) => {
  console.error('[ZeroTTS Server] Pre-warm warning:', err)
})
