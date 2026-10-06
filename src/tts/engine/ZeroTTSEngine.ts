import * as ortWeb from 'onnxruntime-web'
import { BpeTokenizer } from './tokenizer'
import { MossCodecDecoder, CodecMeta } from './codec'
import { Rng } from './rng'
import { normalizeViText } from './textNorm'
import { textSegments } from './chunking'
import {
  ZeroTTSConfig,
  SamplingOptions,
  DEFAULT_SAMPLING,
  VoiceMeta,
  DEFAULT_VOICES
} from './types'

let nodeFs: any = null
let nodePath: any = null
let nodeOs: any = null

try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  nodeFs = typeof require === 'function' ? require('node:fs') || require('fs') : null
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  nodePath = typeof require === 'function' ? require('node:path') || require('path') : null
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  nodeOs = typeof require === 'function' ? require('node:os') || require('os') : null
} catch {
  nodeFs = null
  nodePath = null
  nodeOs = null
}

export const CPU_COUNT: number =
  (typeof nodeOs?.availableParallelism === 'function' ? nodeOs.availableParallelism() : null) ||
  nodeOs?.cpus()?.length ||
  (typeof navigator !== 'undefined' ? navigator.hardwareConcurrency : 4) ||
  4

export function getOptimalCpuThreads(userSpecifiedThreads?: number | string): number {
  if (typeof userSpecifiedThreads === 'number' && userSpecifiedThreads > 0) {
    return Math.floor(userSpecifiedThreads)
  }
  if (typeof userSpecifiedThreads === 'string' && userSpecifiedThreads !== 'auto') {
    const parsed = parseInt(userSpecifiedThreads, 10)
    if (!isNaN(parsed) && parsed > 0) return parsed
  }
  if (typeof process !== 'undefined' && process.env?.ZEROTTS_THREADS) {
    const envParsed = parseInt(process.env.ZEROTTS_THREADS, 10)
    if (!isNaN(envParsed) && envParsed > 0) return envParsed
  }
  return CPU_COUNT
}

let activeOrt: any = null
let isNativeNode = false

export function getOrt(): any {
  if (activeOrt) return activeOrt

  // 1. Cố gắng sử dụng native onnxruntime-node trên Desktop Electron để tối ưu tối đa các nhân CPU
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const nativeOrt = typeof require === 'function' ? require('onnxruntime-node') : null
    if (nativeOrt && nativeOrt.InferenceSession) {
      activeOrt = nativeOrt
      isNativeNode = true
      return activeOrt
    }
  } catch {}

  // 2. Fallback sang onnxruntime-web (WebAssembly)
  activeOrt = ortWeb
  isNativeNode = false
  if (activeOrt?.env?.wasm) {
    activeOrt.env.wasm.numThreads = CPU_COUNT
    activeOrt.env.wasm.simd = true
    activeOrt.env.wasm.proxy = false
  }
  return activeOrt
}

function toBigInt64(values: ArrayLike<number | bigint>): BigInt64Array {
  if (values instanceof BigInt64Array) return values
  const out = new BigInt64Array(values.length)
  for (let i = 0; i < values.length; i++) {
    const v = values[i]
    out[i] = typeof v === 'bigint' ? v : BigInt(Math.trunc(v as number))
  }
  return out
}

function packFrames(
  frames: (BigInt64Array | Int32Array)[],
  K: number
): [Int32Array, number, number] {
  const T = frames.length
  const out = new Int32Array(K * T)
  for (let t = 0; t < T; t++) {
    for (let k = 0; k < K; k++) out[k * T + t] = Number(frames[t][k])
  }
  return [out, K, T]
}

function lastPosition(hidden: any, ort: any): any {
  const [B, T, D] = hidden.dims as number[]
  if (T === 1) return new ort.Tensor('float32', hidden.data as Float32Array, [B, D])
  const data = hidden.data as Float32Array
  const out = new Float32Array(B * D)
  for (let b = 0; b < B; b++) {
    out.set(data.subarray(b * T * D + (T - 1) * D, b * T * D + T * D), b * D)
  }
  return new ort.Tensor('float32', out, [B, D])
}

async function runSession(
  session: any,
  feeds: Record<string, any>
): Promise<any[]> {
  for (const [name, value] of Object.entries(feeds)) {
    if (value == null) {
      throw new Error(`Feed "${name}" is undefined.`)
    }
  }
  const outputs = await session.run(feeds)
  return session.outputNames.map((name: string) => outputs[name])
}

function npyPayload(buffer: ArrayBuffer, descr: RegExp, what: string): [number, string] {
  const bytes = new Uint8Array(buffer)
  if (String.fromCharCode(...bytes.subarray(1, 6)) !== 'NUMPY') {
    throw new Error(`${what}: not a .npy file`)
  }
  const major = bytes[6]
  const view = new DataView(buffer)
  const headerLen = major >= 2 ? view.getUint32(8, true) : view.getUint16(8, true)
  const headerStart = major >= 2 ? 12 : 10
  const header = new TextDecoder().decode(bytes.subarray(headerStart, headerStart + headerLen))

  if (!descr.test(header)) throw new Error(`${what}: unexpected dtype — ${header}`)
  return [headerStart + headerLen, header]
}

function parseNpyFloat32(buffer: ArrayBuffer): Float32Array {
  const [offset] = npyPayload(buffer, /'descr':\s*'[<|]f4'/, 'null_voice_emb.npy')
  return new Float32Array(buffer, offset)
}

function parseNpyInt64(buffer: ArrayBuffer): BigInt64Array {
  const [offset] = npyPayload(buffer, /'descr':\s*'[<|]i8'/, 'silence_frame.npy')
  if (offset % 8 === 0) return new BigInt64Array(buffer, offset)
  return new BigInt64Array(buffer.slice(offset))
}

const LOCAL_CANDIDATES = ['./model', '../model']

export class ZeroTTSEngine {
  static SAMPLE_RATE = 48000

  private sessions: {
    textEncoder?: any
    prefixStep?: any
    localFrameDecode?: any
  } = {}

  private codec?: MossCodecDecoder
  private tokenizer?: BpeTokenizer
  private config: ZeroTTSConfig = {
    sample_rate: 48000,
    num_codebooks: 16,
    codebook_size: 1024,
    d_model: 768,
    n_layers: 9,
    n_heads: 12,
    n_voice_queries: 10
  }

  private nullVoiceEmb: Float32Array = new Float32Array(7680)
  private silenceFrame: BigInt64Array | null = null
  private voiceCache = new Map<string, Float32Array>()
  private voiceList: VoiceMeta[] = DEFAULT_VOICES

  public isInitialized = false
  public isReadyForInference = false
  private initPromise: Promise<void> | null = null

  constructor(private novel: NovelExtensionApi) {
    getOrt()
  }

  private async log(message: string, ...args: any[]): Promise<void> {
    const formatted = `[ZeroTTS-CPU] ${message}`
    if (this.novel.logger?.info) {
      await this.novel.logger.info(formatted, ...args)
    } else {
      console.log(formatted, ...args)
    }
  }

  private async warn(message: string, ...args: any[]): Promise<void> {
    const formatted = `[ZeroTTS-CPU WARN] ${message}`
    if (this.novel.logger?.warn) {
      await this.novel.logger.warn(formatted, ...args)
    } else {
      console.warn(formatted, ...args)
    }
  }

  private async error(message: string, ...args: any[]): Promise<void> {
    const formatted = `[ZeroTTS-CPU ERROR] ${message}`
    if (this.novel.logger?.error) {
      await this.novel.logger.error(formatted, ...args)
    } else {
      console.error(formatted, ...args)
    }
  }

  resolveVoiceId(rawId?: string): string {
    if (!rawId || typeof rawId !== 'string') return 'maichi'
    const trimmed = rawId.trim()
    if (!trimmed) return 'maichi'

    const lower = trimmed.toLowerCase()

    // 1. Khớp chính xác id voice (ví dụ: 'maichi', 'baotrang', 'quangminh')
    const directMatch = this.voiceList.find((v) => v.name.toLowerCase() === lower)
    if (directMatch) return directMatch.name

    // 2. Khớp với display_name (ví dụ: 'Mai Chi', 'Bảo Trang', 'Quang Minh')
    const displayMatch = this.voiceList.find((v) => v.display_name.toLowerCase() === lower)
    if (displayMatch) return displayMatch.name

    // 3. Khớp substring (ví dụ: "👩 Mai Chi (Nữ trẻ...)", "quangminh (nam)", v.v.)
    for (const v of this.voiceList) {
      if (lower.includes(v.name.toLowerCase()) || lower.includes(v.display_name.toLowerCase())) {
        return v.name
      }
    }

    return 'maichi'
  }

  private async getBuffer(relativePath: string): Promise<ArrayBuffer | null> {
    const normalized = relativePath.replace(/\\/g, '/')
    const candidates = [
      `models/${normalized}`,
      `model/${normalized}`,
      normalized,
    ]

    // 1. novel.storage API (khi chạy trong app e-novels / Novel-electron)
    if (this.novel.storage) {
      for (const p of candidates) {
        try {
          const fileObj = await this.novel.storage.get(p)
          if (fileObj) {
            if (typeof (fileObj as any).arrayBuffer === 'function') {
              return await (fileObj as any).arrayBuffer()
            }
            if (fileObj instanceof ArrayBuffer) {
              return fileObj
            }
            if ((fileObj as any).buffer instanceof ArrayBuffer) {
              const b = (fileObj as any).buffer as ArrayBuffer
              const offset = (fileObj as any).byteOffset || 0
              const len = (fileObj as any).byteLength || b.byteLength
              return b.slice(offset, offset + len)
            }
            if (fileObj instanceof Uint8Array || ArrayBuffer.isView(fileObj)) {
              const view = fileObj as ArrayBufferView
              return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength) as ArrayBuffer
            }
          }
        } catch {}
      }

      // 1b. novel.storage.createAssetUrl fallback với fetch
      for (const p of candidates) {
        try {
          const assetUrl = await this.novel.storage.createAssetUrl(p)
          if (assetUrl && typeof fetch !== 'undefined') {
            const res = await fetch(assetUrl)
            if (res.ok) {
              return await res.arrayBuffer()
            }
          }
        } catch {}
      }
    }

    // 2. Local candidate directories on disk
    if (nodeFs) {
      const diskDirs = [
        ...LOCAL_CANDIDATES,
        './models',
        '../models',
        '/Users/dovanhai/ZeroTTS-CPU/model',
        typeof __dirname !== 'undefined' && nodePath ? nodePath.join(__dirname, 'model') : null,
        typeof __dirname !== 'undefined' && nodePath ? nodePath.join(__dirname, 'models') : null,
        typeof __dirname !== 'undefined' && nodePath ? nodePath.join(__dirname, '../model') : null,
        typeof __dirname !== 'undefined' && nodePath ? nodePath.join(__dirname, '../models') : null,
      ].filter(Boolean) as string[]

      for (const candidate of diskDirs) {
        try {
          const full = nodePath ? nodePath.join(candidate, normalized) : `${candidate}/${normalized}`
          if (nodeFs.existsSync(full)) {
            const buf = nodeFs.readFileSync(full)
            return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length) as ArrayBuffer
          }
        } catch {}
      }
    }

    return null
  }

  private async loadWasmBinary(threadCount = CPU_COUNT): Promise<void> {
    const ortInstance = getOrt()
    if (isNativeNode) return
    if (ortInstance?.env?.wasm?.wasmBinary) return

    // 1. novel.storage SDK
    if (this.novel.storage) {
      try {
        const wasmFile =
          (await this.novel.storage.get('dist/ort-wasm-simd-threaded.wasm')) ||
          (await this.novel.storage.get('models/ort-wasm-simd-threaded.wasm'))
        if (wasmFile) {
          let uint8Wasm: Uint8Array | null = null
          if (typeof (wasmFile as any).arrayBuffer === 'function') {
            const ab = await (wasmFile as any).arrayBuffer()
            uint8Wasm = new Uint8Array(ab)
          } else if (wasmFile instanceof Uint8Array) {
            uint8Wasm = wasmFile
          } else if ((wasmFile as any).buffer instanceof ArrayBuffer) {
            uint8Wasm = new Uint8Array((wasmFile as any).buffer)
          }
          if (uint8Wasm && uint8Wasm.byteLength > 0) {
            const isIsolated = typeof crossOriginIsolated !== 'undefined' && crossOriginIsolated
            const threads = isIsolated ? threadCount : 1
            ortInstance.env.wasm.wasmBinary = uint8Wasm
            ortInstance.env.wasm.numThreads = threads
            ortInstance.env.wasm.proxy = false
            delete ortInstance.env.wasm.wasmPaths
            await this.log(
              `[WASM] Loaded WebAssembly binary from storage (${(uint8Wasm.byteLength / 1024 / 1024).toFixed(
                2
              )} MB) - Threading: ${threads} thread(s) (crossOriginIsolated: ${Boolean(isIsolated)}, Cores: ${CPU_COUNT})`
            )
            return
          }
        }
      } catch (e: any) {
        await this.warn(`[WASM] Failed loading WASM binary from novel.storage: ${e?.message || String(e)}`)
      }
    }

    // 2. Direct local candidate if nodeFs is available
    if (nodeFs) {
      const candidates = [
        ...LOCAL_CANDIDATES,
        './dist',
        '../dist',
        '/Users/dovanhai/ZeroTTS-CPU/dist',
        typeof __dirname !== 'undefined' && nodePath ? nodePath.join(__dirname, 'dist') : null,
        typeof __dirname !== 'undefined' && nodePath ? nodePath.join(__dirname, '../dist') : null,
      ].filter(Boolean) as string[]

      for (const dir of candidates) {
        try {
          const wasmPath = nodePath
            ? nodePath.join(dir, 'ort-wasm-simd-threaded.wasm')
            : `${dir}/ort-wasm-simd-threaded.wasm`
          if (nodeFs.existsSync(wasmPath)) {
            const isIsolated = typeof crossOriginIsolated !== 'undefined' && crossOriginIsolated
            const threads = isIsolated ? threadCount : 1
            const buf = nodeFs.readFileSync(wasmPath)
            ortInstance.env.wasm.wasmBinary = new Uint8Array(buf)
            ortInstance.env.wasm.numThreads = threads
            ortInstance.env.wasm.proxy = false
            delete ortInstance.env.wasm.wasmPaths
            await this.log(
              `[WASM] Loaded WebAssembly binary from local disk: ${wasmPath} - Threading: ${threads} thread(s) (Cores: ${CPU_COUNT})`
            )
            return
          }
        } catch {}
      }
    }

    // 3. Virtual asset URL fetch
    if (this.novel.storage) {
      try {
        const assetUrl =
          (await this.novel.storage.createAssetUrl('dist/ort-wasm-simd-threaded.wasm')) ||
          (await this.novel.storage.createAssetUrl('models/ort-wasm-simd-threaded.wasm'))
        if (assetUrl && typeof fetch !== 'undefined') {
          const res = await fetch(assetUrl)
          if (res.ok) {
            const isIsolated = typeof crossOriginIsolated !== 'undefined' && crossOriginIsolated
            const threads = isIsolated ? threadCount : 1
            const ab = await res.arrayBuffer()
            const uint8Wasm = new Uint8Array(ab)
            ortInstance.env.wasm.wasmBinary = uint8Wasm
            ortInstance.env.wasm.numThreads = threads
            ortInstance.env.wasm.proxy = false
            delete ortInstance.env.wasm.wasmPaths
            await this.log(
              `[WASM] Loaded WebAssembly binary from virtual asset URL (${(uint8Wasm.byteLength / 1024 / 1024).toFixed(
                2
              )} MB) - Threading: ${threads} thread(s) (Cores: ${CPU_COUNT})`
            )
            return
          }
        }
      } catch (e: any) {
        await this.warn(`[WASM] Failed loading WASM binary from assetUrl: ${e?.message || String(e)}`)
      }
    }
  }

  initialize(customThreads?: number | string): Promise<void> {
    if (this.isInitialized) return Promise.resolve()
    if (this.initPromise) return this.initPromise

    this.initPromise = (async () => {
      const ortInstance = getOrt()
      const threadCount = getOptimalCpuThreads(customThreads ?? this.config.cpuThreads)
      await this.log(
        `Initializing ZeroTTS CPU Engine (Runtime: ${
          isNativeNode ? 'Native C++ onnxruntime-node' : 'WebAssembly onnxruntime-web'
        }, CPU Cores: ${CPU_COUNT}, Active Threads: ${threadCount} [100% CPU power])`
      )

      try {
        // 1. Load config.json
        const configBuf = await this.getBuffer('config.json')
        if (configBuf && configBuf.byteLength > 10) {
          try {
            const parsed = JSON.parse(new TextDecoder().decode(configBuf))
            this.config = { ...this.config, ...parsed }
          } catch {}
        }

        // 2. Load voices/index.json
        const voicesBuf = await this.getBuffer('voices/index.json')
        if (voicesBuf && voicesBuf.byteLength > 10) {
          try {
            const parsed = JSON.parse(new TextDecoder().decode(voicesBuf))
            if (parsed && Array.isArray(parsed.voices)) {
              this.voiceList = parsed.voices
            }
          } catch {}
        }

        // 3. Load tokenizer.json
        const tokenizerBuf = await this.getBuffer('tokenizer.json')
        if (tokenizerBuf && tokenizerBuf.byteLength > 100) {
          try {
            const tokenizerJson = JSON.parse(new TextDecoder().decode(tokenizerBuf))
            this.tokenizer = await BpeTokenizer.create(tokenizerJson)
          } catch (e: any) {
            await this.warn(`Tokenizer loading warning: ${e?.message || String(e)}`)
          }
        }

        // 4. Load null_voice_emb.npy & silence_frame.npy
        const nullVoiceBuf = await this.getBuffer('null_voice_emb.npy')
        if (nullVoiceBuf && nullVoiceBuf.byteLength > 500) {
          try {
            this.nullVoiceEmb = parseNpyFloat32(nullVoiceBuf)
          } catch {}
        }

        const silenceBuf = await this.getBuffer('silence_frame.npy')
        if (silenceBuf && silenceBuf.byteLength > 100) {
          try {
            this.silenceFrame = parseNpyInt64(silenceBuf)
          } catch {}
        }

        // 5. Cấu hình Session Options tối ưu hoá CPU đa luồng 100%
        const sessionOptions: any = {
          executionProviders: isNativeNode ? ['cpu'] : ['wasm'],
          graphOptimizationLevel: 'all',
        }

        if (isNativeNode) {
          sessionOptions.intraOpNumThreads = threadCount
          sessionOptions.interOpNumThreads = Math.max(1, Math.min(4, Math.floor(threadCount / 2)))
          sessionOptions.executionMode = 'sequential'
          sessionOptions.enableCpuMemArena = true
          sessionOptions.enableMemPattern = true
          await this.log(
            `Configured native ONNX CPU multi-threading: intraOpNumThreads=${sessionOptions.intraOpNumThreads}, interOpNumThreads=${sessionOptions.interOpNumThreads}, memArena=true (100% CPU capacity across all ${CPU_COUNT} logical cores)`
          )
        } else {
          await this.loadWasmBinary(threadCount)
        }

        // 6. Kiểm tra và nạp các mô hình ONNX
        const textEncoderBuf = await this.getBuffer('onnx/text_encoder.onnx')
        const prefixStepBuf = await this.getBuffer('onnx/prefix_step.onnx')
        const localFrameDecodeBuf = await this.getBuffer('onnx/local_frame_decode.onnx')
        const codecFullBuf = await this.getBuffer('onnx/codec/moss_audio_tokenizer_decode_full.onnx')
        const codecMetaBuf = await this.getBuffer('onnx/codec/codec_browser_onnx_meta.json')
        const codecSharedData = await this.getBuffer('onnx/codec/moss_audio_tokenizer_decode_shared.data')

        // Kiểm tra xem đây có phải là file ONNX thực tế không (kích thước > 100KB, không phải stub git-lfs)
        const hasRealWeights =
          textEncoderBuf && textEncoderBuf.byteLength > 100000 &&
          prefixStepBuf && prefixStepBuf.byteLength > 100000 &&
          localFrameDecodeBuf && localFrameDecodeBuf.byteLength > 100000 &&
          codecFullBuf && codecFullBuf.byteLength > 100000

        if (hasRealWeights) {
          await this.log('Loading 3 ZeroTTS ONNX graphs and MOSS Codec decoder into memory...')

          const codecOptions = {
            ...sessionOptions,
            intraOpNumThreads: threadCount,
            externalData: codecSharedData
              ? [
                  {
                    path: 'moss_audio_tokenizer_decode_shared.data',
                    data: new Uint8Array(codecSharedData),
                  },
                ]
              : undefined,
          }

          const toUint8 = (b: ArrayBuffer) => new Uint8Array(b)
          const [textEncoder, prefixStep, localFrameDecode, codecFull] = await Promise.all([
            ortInstance.InferenceSession.create(toUint8(textEncoderBuf), sessionOptions),
            ortInstance.InferenceSession.create(toUint8(prefixStepBuf), sessionOptions),
            ortInstance.InferenceSession.create(toUint8(localFrameDecodeBuf), sessionOptions),
            ortInstance.InferenceSession.create(toUint8(codecFullBuf), codecOptions),
          ])

          this.sessions.textEncoder = textEncoder
          this.sessions.prefixStep = prefixStep
          this.sessions.localFrameDecode = localFrameDecode

          let codecMeta: CodecMeta = {
            codec_config: { sample_rate: 48000, channels: 2, downsample_rate: 3840, num_quantizers: 16 }
          }
          if (codecMetaBuf) {
            try {
              codecMeta = JSON.parse(new TextDecoder().decode(codecMetaBuf))
            } catch {}
          }

          this.codec = await MossCodecDecoder.create(codecMeta, codecFull, ortInstance)
          this.isReadyForInference = true
          await this.log('🎉 All ZeroTTS ONNX models loaded successfully with multi-core CPU acceleration!')
        } else {
          await this.warn('ZeroTTS model files are not yet available or are corrupted. Please verify model downloads.')
        }

        this.isInitialized = true
      } catch (err: unknown) {
        this.initPromise = null
        await this.error(`Failed during initialize: ${err instanceof Error ? err.stack || err.message : String(err)}`)
      }
    })()

    return this.initPromise
  }

  getVoices(): ExtensionTTSGetVoicesResponse {
    return {
      voices: this.voiceList.map((v) => ({
        id: v.name,
        name: `${v.display_name} (${v.description || v.gender})`,
        lang: 'vi-VN',
      })),
    }
  }

  async getVoiceEmbedding(rawVoiceId: string): Promise<Float32Array> {
    const voiceId = this.resolveVoiceId(rawVoiceId)
    if (this.voiceCache.has(voiceId)) {
      return this.voiceCache.get(voiceId)!
    }

    const buf = await this.getBuffer(`voices/${voiceId}/voice.bin`)
    if (buf && buf.byteLength >= 7680 * 4) {
      const emb = new Float32Array(buf.slice(0, 7680 * 4))
      this.voiceCache.set(voiceId, emb)
      await this.log(`✅ Loaded voice embedding for "${voiceId}" (${emb.byteLength} bytes)`)
      return emb
    }

    await this.warn(`⚠️ Could not load voice embedding for "${voiceId}" (requested: "${rawVoiceId}"), falling back to nullVoiceEmb`)
    return this.nullVoiceEmb
  }

  private i64(values: ArrayLike<number | bigint>, dims: number[]): any {
    const ort = getOrt()
    return new ort.Tensor('int64', toBigInt64(values), dims)
  }

  private async prefixStepInit(
    textIds: BigInt64Array,
    textLen: number,
    voiceEmb: Float32Array,
    B: number
  ): Promise<any> {
    const ort = getOrt()
    const V = this.config.n_voice_queries
    const D = this.config.d_model

    const idsBatched = B === 1 ? textIds : (() => {
      const out = new BigInt64Array(B * textLen)
      for (let b = 0; b < B; b++) out.set(textIds, b * textLen)
      return out
    })()

    const [, textValid, soaEmbed, crossKv] = await runSession(this.sessions.textEncoder, {
      text_ids: this.i64(idsBatched, [B, textLen]),
      txt_lengths: this.i64(new Array(B).fill(textLen), [B]),
    })

    const T = V + 1
    const external = new Float32Array(B * T * D)
    const soa = soaEmbed.data as Float32Array
    for (let b = 0; b < B; b++) {
      external.set(voiceEmb.subarray(b * V * D, (b + 1) * V * D), b * T * D)
      external.set(soa.subarray(b * D, (b + 1) * D), b * T * D + V * D)
    }

    const newPos = new BigInt64Array(B * T)
    for (let b = 0; b < B; b++) for (let t = 0; t < T; t++) newPos[b * T + t] = BigInt(t)

    const bidirectional = new Uint8Array(B * T)
    for (let b = 0; b < B; b++) bidirectional.fill(1, b * T, b * T + V)

    const [hidden, packedKv, fullValid] = await runSession(this.sessions.prefixStep, {
      external_embed: new ort.Tensor('float32', external, [B, T, D]),
      use_external_embed: new ort.Tensor('bool', new Uint8Array(B * T).fill(1), [B, T]),
      frame_codes: this.i64(new BigInt64Array(B * T * this.config.num_codebooks), [B, T, this.config.num_codebooks]),
      new_pos: this.i64(newPos, [B, T]),
      new_valid: new ort.Tensor('bool', new Uint8Array(B * T).fill(1), [B, T]),
      packed_kv: new ort.Tensor('float32', new Float32Array(0), [this.config.n_layers, 2, B, this.config.n_heads, 0, D / this.config.n_heads]),
      new_bidirectional: new ort.Tensor('bool', bidirectional, [B, T]),
      past_valid: new ort.Tensor('bool', new Uint8Array(0), [B, 0]),
      cross_kv: crossKv,
      text_valid: textValid,
    })

    return {
      hidden: lastPosition(hidden, ort),
      packedKv,
      fullValid,
      crossKv,
      textValid,
    }
  }

  private async prefixStepFrame(
    codes: BigInt64Array,
    frameIndex: number,
    state: any,
    nVoice: number,
    B: number,
    sharedPrefix?: any
  ): Promise<any> {
    const ort = getOrt()
    const K = this.config.num_codebooks
    const D = this.config.d_model

    const tiled = B === 1 ? codes : (() => {
      const out = new BigInt64Array(B * K)
      for (let b = 0; b < B; b++) out.set(codes, b * K)
      return out
    })()

    const pos = new BigInt64Array(B).fill(BigInt(nVoice + 1 + frameIndex))

    const [hidden, packedKv, fullValid] = await runSession(this.sessions.prefixStep, {
      external_embed: sharedPrefix?.externalEmbed || new ort.Tensor('float32', new Float32Array(B * D), [B, 1, D]),
      use_external_embed: sharedPrefix?.useExternalEmbed || new ort.Tensor('bool', new Uint8Array(B), [B, 1]),
      frame_codes: this.i64(tiled, [B, 1, K]),
      new_pos: this.i64(pos, [B, 1]),
      new_valid: sharedPrefix?.newValid || new ort.Tensor('bool', new Uint8Array(B).fill(1), [B, 1]),
      packed_kv: state.packedKv,
      past_valid: state.fullValid,
      cross_kv: state.crossKv,
      new_bidirectional: sharedPrefix?.newBidirectional || new ort.Tensor('bool', new Uint8Array(B), [B, 1]),
      text_valid: state.textValid,
    })

    return {
      hidden: lastPosition(hidden, ort),
      packedKv,
      fullValid,
      crossKv: state.crossKv,
      textValid: state.textValid,
    }
  }

  private async localDecodeFrame(
    hidden: any,
    forbidEoa: boolean,
    opts: SamplingOptions,
    seenMask: Uint8Array,
    B: number,
    rng: Rng,
    preallocated?: any
  ): Promise<{ isEoa: boolean; codes: BigInt64Array }> {
    const ort = getOrt()
    const K = this.config.num_codebooks
    const [isEoaT, codesT] = await runSession(this.sessions.localFrameDecode, {
      global_hidden: hidden,
      forbid_eoa: forbidEoa
        ? (preallocated?.forbidEoaTrue || new ort.Tensor('bool', Uint8Array.from([1]), [1]))
        : (preallocated?.forbidEoaFalse || new ort.Tensor('bool', Uint8Array.from([0]), [1])),
      text_temperature: preallocated?.textTemp || new ort.Tensor('float32', Float32Array.from([opts.textTemperature]), [1]),
      text_topk: preallocated?.textTopk || this.i64([opts.textTopK > 0 ? opts.textTopK : this.config.codebook_size], [1]),
      audio_temperature: preallocated?.audioTemp || new ort.Tensor('float32', Float32Array.from([opts.audioTemperature]), [1]),
      audio_topk: preallocated?.audioTopk || this.i64([opts.audioTopK > 0 ? opts.audioTopK : this.config.codebook_size], [1]),
      audio_topp: preallocated?.audioTopp || new ort.Tensor('float32', Float32Array.from([opts.audioTopP]), [1]),
      audio_repetition_penalty: preallocated?.audioRep || new ort.Tensor('float32', Float32Array.from([opts.audioRepetitionPenalty]), [1]),
      seen_mask: new ort.Tensor('bool', seenMask, [1, K, this.config.codebook_size]),
      ctrl_random_u: new ort.Tensor('float32', rng.fill(new Float32Array(1)), [1]),
      audio_random_u: new ort.Tensor('float32', rng.fill(new Float32Array(K)), [1, K]),
      cfg_scale: preallocated?.cfgScale || new ort.Tensor('float32', Float32Array.from([opts.cfgScale]), [1]),
    })

    const codes = toBigInt64(codesT.data as ArrayLike<number | bigint>)
    for (let c = 0; c < K; c++) {
      seenMask[c * this.config.codebook_size + Number(codes[c])] = 1
    }
    return { isEoa: Boolean((isEoaT.data as Uint8Array)[0]), codes }
  }

  async *generateFrames(
    text: string,
    voiceEmb: Float32Array,
    options: Partial<SamplingOptions> = {},
    seed?: number
  ): AsyncGenerator<BigInt64Array> {
    const opts = { ...DEFAULT_SAMPLING, ...options }
    const rng = new Rng(seed)
    let voice = voiceEmb
    const B = opts.cfgScale > 1.0 ? 2 : 1
    if (B === 2) {
      const stacked = new Float32Array(voice.length + this.nullVoiceEmb.length)
      stacked.set(voice, 0)
      stacked.set(this.nullVoiceEmb, voice.length)
      voice = stacked
    }

    if (!this.tokenizer) {
      throw new Error('Tokenizer not initialized')
    }

    const ids = this.tokenizer.encode(text)
    let state = await this.prefixStepInit(ids, ids.length, voice, B)
    const seenMask = new Uint8Array(this.config.num_codebooks * this.config.codebook_size)
    let tailLeft: number | null = null

    const ort = getOrt()
    const D = this.config.d_model
    const preallocated = {
      forbidEoaTrue: new ort.Tensor('bool', Uint8Array.from([1]), [1]),
      forbidEoaFalse: new ort.Tensor('bool', Uint8Array.from([0]), [1]),
      textTemp: new ort.Tensor('float32', Float32Array.from([opts.textTemperature]), [1]),
      textTopk: this.i64([opts.textTopK > 0 ? opts.textTopK : this.config.codebook_size], [1]),
      audioTemp: new ort.Tensor('float32', Float32Array.from([opts.audioTemperature]), [1]),
      audioTopk: this.i64([opts.audioTopK > 0 ? opts.audioTopK : this.config.codebook_size], [1]),
      audioTopp: new ort.Tensor('float32', Float32Array.from([opts.audioTopP]), [1]),
      audioRep: new ort.Tensor('float32', Float32Array.from([opts.audioRepetitionPenalty]), [1]),
      cfgScale: new ort.Tensor('float32', Float32Array.from([opts.cfgScale]), [1]),
    }
    const sharedPrefix = {
      externalEmbed: new ort.Tensor('float32', new Float32Array(B * D), [B, 1, D]),
      useExternalEmbed: new ort.Tensor('bool', new Uint8Array(B), [B, 1]),
      newValid: new ort.Tensor('bool', new Uint8Array(B).fill(1), [B, 1]),
      newBidirectional: new ort.Tensor('bool', new Uint8Array(B), [B, 1]),
    }

    for (let t = 0; ; t++) {
      const { isEoa, codes } = await this.localDecodeFrame(
        state.hidden,
        t < opts.minFrames || tailLeft !== null,
        opts,
        seenMask,
        B,
        rng,
        preallocated
      )

      if (tailLeft === null && isEoa) tailLeft = Math.max(0, opts.eoaExtraFrames)
      if ((tailLeft !== null && tailLeft <= 0) || t >= opts.maxFrames) return

      yield codes

      if (tailLeft !== null) {
        tailLeft -= 1
        if (tailLeft <= 0) return
      }

      state = await this.prefixStepFrame(codes, t, state, this.config.n_voice_queries, B, sharedPrefix)
    }
  }

  async synthesizeSegment(
    text: string,
    voiceEmb: Float32Array,
    options: Partial<SamplingOptions> = {}
  ): Promise<Float32Array> {
    if (!this.codec) {
      throw new Error('Codec not initialized')
    }

    const frames: BigInt64Array[] = []
    for await (const frame of this.generateFrames(text, voiceEmb, options)) {
      frames.push(frame)
    }

    if (!frames.length) return new Float32Array(0)
    const [codes, K, T] = packFrames(frames, this.config.num_codebooks)
    return await this.codec.decode(codes, K, T)
  }

  async synthesize(
    rawText: string,
    voiceId = 'maichi',
    options: Partial<SamplingOptions> = {}
  ): Promise<Float32Array> {
    const threadCount = getOptimalCpuThreads(options.cpuThreads || this.config.cpuThreads)
    await this.initialize(threadCount)

    if (!this.isReadyForInference) {
      throw new Error(
        'ZeroTTS CPU models are not yet loaded. Please ensure model weights are available on disk or downloaded via extension resources.'
      )
    }

    const tStart = Date.now()
    const voiceEmb = await this.getVoiceEmbedding(voiceId)
    const normalized = normalizeViText(rawText)
    const segments = textSegments(normalized)

    await this.log(
      `[ZeroTTS Synthesize] Starting synthesis for ${segments.length} segment(s) across all ${CPU_COUNT} CPU cores (Active Threads: ${threadCount})`
    )

    const audioBuffers: Float32Array[] = []
    const silenceSamples = Math.floor(ZeroTTSEngine.SAMPLE_RATE * 0.25) // 0.25s silence between segments

    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i]
      if (!segment.trim()) continue

      await this.log(`[ZeroTTS Segment ${i + 1}/${segments.length}] Synthesizing: "${segment}"`)
      const segAudio = await this.synthesizeSegment(segment, voiceEmb, options)
      if (segAudio.length > 0) {
        audioBuffers.push(segAudio)
        if (i < segments.length - 1) {
          audioBuffers.push(new Float32Array(silenceSamples))
        }
      }
    }

    const totalLen = audioBuffers.reduce((acc, b) => acc + b.length, 0)
    const fullAudio = new Float32Array(totalLen)
    let offset = 0
    for (const b of audioBuffers) {
      fullAudio.set(b, offset)
      offset += b.length
    }

    const elapsed = Date.now() - tStart
    const audioSec = fullAudio.length / ZeroTTSEngine.SAMPLE_RATE
    await this.log(
      `[ZeroTTS Synthesize] Synthesized ${fullAudio.length} samples (${audioSec.toFixed(2)}s) in ${elapsed}ms (RTF: ${(
        elapsed / ((audioSec * 1000) || 1)
      ).toFixed(3)}x, Multi-core Threads: ${threadCount})`
    )

    return fullAudio
  }
}
