/**
 * MOSS-Audio-Tokenizer-Nano decoder — codes to waveform for ZeroTTS.
 * Port of zerotts/codec.py.
 */

export interface CodecConfig {
  sample_rate: number
  channels: number
  downsample_rate: number
  num_quantizers: number
}

export interface CodecMeta {
  files?: Record<string, string>
  codec_config: CodecConfig
}

function transposeToBTK(codes: Int32Array, B: number, K: number, T: number): Int32Array {
  const out = new Int32Array(B * T * K)
  for (let b = 0; b < B; b++) {
    for (let k = 0; k < K; k++) {
      for (let t = 0; t < T; t++) {
        out[b * T * K + t * K + k] = codes[b * K * T + k * T + t]
      }
    }
  }
  return out
}

function toMono(data: Float32Array, _B: number, C: number, T: number, n: number): Float32Array {
  const out = new Float32Array(n)
  for (let t = 0; t < n; t++) {
    let sum = 0
    for (let c = 0; c < C; c++) sum += data[c * T + t]
    out[t] = sum / C
  }
  return out
}

export class MossCodecDecoder {
  readonly sampleRate: number
  readonly numChannels: number
  readonly numCodebooks: number
  readonly frameSize: number

  private constructor(
    private decodeFull: any,
    private meta: CodecMeta,
    private ort: any
  ) {
    const cfg = meta.codec_config
    this.sampleRate = cfg.sample_rate || 48000
    this.numChannels = cfg.channels || 2
    this.numCodebooks = cfg.num_quantizers || 16
    this.frameSize = cfg.downsample_rate || 3840
  }

  static async create(
    meta: CodecMeta,
    decodeFullSession: any,
    ortInstance: any
  ): Promise<MossCodecDecoder> {
    return new MossCodecDecoder(decodeFullSession, meta, ortInstance)
  }

  async decode(codesKT: Int32Array, K: number, T: number): Promise<Float32Array> {
    const btk = transposeToBTK(codesKT, 1, K, T)
    const outputs = await this.decodeFull.run({
      audio_codes: new this.ort.Tensor('int32', btk, [1, T, K]),
      audio_code_lengths: new this.ort.Tensor('int32', Int32Array.from([T]), [1]),
    })
    const audio = outputs.audio
    const lengths = outputs.audio_lengths
    const n = Number((lengths.data as Int32Array)[0])
    const [, C, Tfull] = audio.dims as number[]
    return toMono(audio.data as Float32Array, 1, C, Tfull, n)
  }
}
