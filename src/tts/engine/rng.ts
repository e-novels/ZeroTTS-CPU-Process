/**
 * Seedable PRNG (mulberry32) for ZeroTTS sampling.
 */
export class Rng {
  private state: number

  constructor(seed?: number) {
    this.state = (seed ?? Math.floor(Math.random() * 0xffffffff)) >>> 0
  }

  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0
    let t = this.state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  fill(out: Float32Array): Float32Array {
    for (let i = 0; i < out.length; i++) out[i] = this.next()
    return out
  }
}
