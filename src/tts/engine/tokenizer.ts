/**
 * Self-contained pure TypeScript BPE tokenization for ZeroTTS.
 * Port of zerotts/tokenizer.py and compatible with HuggingFace Tokenizers JSON.
 *
 * Zero external dependencies — avoids Node.js external imports (sharp, fs, child_process)
 * that cause runtime crashes in sandboxed browser/worker environments.
 */

export const SPECIAL_TOKENS: Record<string, number> = {
  '<pad>': 0,
  '<bos>': 1,
  '<eot>': 2,
  '<soa>': 3,
  '<slot>': 4,
  '<eoa>': 5,
  '<en>': 6,
  '<vi>': 7,
}

const PRE_TOKEN_REGEX = /(\s+|[\p{P}\p{S}]|\d|[^\s\p{P}\p{S}\d]+)/gu

/**
 * NFC + whitespace collapse. Case and punctuation are preserved verbatim.
 * Identical to Python and HuggingFace normalizeText.
 */
export function normalizeText(text: string): string {
  return text.normalize('NFC').replace(/\s+/g, ' ')
}

export class BpeTokenizer {
  private vocab: Map<string, number>
  private reverseVocab: Map<number, string>
  private mergeRanks: Map<string, number>
  private unkId: number

  private constructor(
    vocab: Record<string, number> | Map<string, number>,
    merges: (string | [string, string])[]
  ) {
    this.vocab = vocab instanceof Map ? vocab : new Map(Object.entries(vocab))
    this.reverseVocab = new Map()
    for (const [token, id] of this.vocab.entries()) {
      this.reverseVocab.set(id, token)
    }

    this.unkId = this.vocab.get('<unk>') ?? 8
    this.mergeRanks = new Map()

    for (let idx = 0; idx < merges.length; idx++) {
      const pair = merges[idx]
      let a: string
      let b: string
      if (Array.isArray(pair)) {
        ;[a, b] = pair
      } else {
        const splitIdx = pair.indexOf(' ')
        if (splitIdx !== -1) {
          a = pair.slice(0, splitIdx)
          b = pair.slice(splitIdx + 1)
        } else {
          a = pair
          b = ''
        }
      }
      this.mergeRanks.set(`${a}\0${b}`, idx)
    }

    this.assertSpecialIds()
  }

  static async create(tokenizerJson: any): Promise<BpeTokenizer> {
    if (!tokenizerJson || typeof tokenizerJson !== 'object') {
      throw new Error('Invalid tokenizer.json payload: expected object')
    }

    const model = tokenizerJson.model || {}
    const vocab = model.vocab || {}
    const merges = model.merges || []

    return new BpeTokenizer(vocab, merges)
  }

  private assertSpecialIds(): void {
    for (const [token, want] of Object.entries(SPECIAL_TOKENS)) {
      const got = this.vocab.get(token)
      if (got !== undefined && got !== want) {
        throw new Error(
          `tokenizer special id mismatch: ${token} is ${got}, must be ${want}. ` +
            'This tokenizer does not belong to these weights.'
        )
      }
    }
  }

  private bpe(token: string): string[] {
    if (token.length <= 1) return [token]
    const word = Array.from(token)
    while (word.length > 1) {
      let minRank = Infinity
      let minPairIdx = -1
      for (let i = 0; i < word.length - 1; i++) {
        const rank = this.mergeRanks.get(`${word[i]}\0${word[i + 1]}`)
        if (rank !== undefined && rank < minRank) {
          minRank = rank
          minPairIdx = i
        }
      }
      if (minPairIdx === -1) break
      word.splice(minPairIdx, 2, word[minPairIdx] + word[minPairIdx + 1])
    }
    return word
  }

  private encodeBody(text: string): number[] {
    const norm = normalizeText(text)
    const pieces = norm.match(PRE_TOKEN_REGEX) || []
    const tokens: string[] = []

    for (const piece of pieces) {
      if (piece.length === 0) continue
      if (/^\s+$/.test(piece) || /^[\p{P}\p{S}]$/u.test(piece) || /^\d$/.test(piece)) {
        tokens.push(piece)
      } else {
        tokens.push(...this.bpe(piece))
      }
    }

    return tokens.map((t) => this.vocab.get(t) ?? this.unkId)
  }

  encode(text: string, maxLength = 512): BigInt64Array {
    const body = this.encodeBody(text).slice(0, maxLength)
    const ids = [SPECIAL_TOKENS['<bos>'], ...body, SPECIAL_TOKENS['<eot>']]
    return BigInt64Array.from(ids.map((v) => BigInt(v)))
  }

  decode(ids: ArrayLike<number | bigint>): string {
    const pieces: string[] = []
    for (let i = 0; i < ids.length; i++) {
      const v = Number(ids[i])
      if (v >= Object.keys(SPECIAL_TOKENS).length) {
        const str = this.reverseVocab.get(v)
        if (str !== undefined) pieces.push(str)
      }
    }
    return pieces.join('')
  }
}
