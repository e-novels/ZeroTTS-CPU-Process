/**
 * Punctuation normalization + sentence chunking for ZeroTTS.
 * Port of zerotts/chunking.py.
 */

const SENTENCE_END = /(?<=[.!?…])\s+/
const COMMA = /(?<=,)\s+/

const CHARS_PER_SEC = 15.0
const EXISTING_PUNCT = new Set([...'.!?…,;:—–-"\')]}'])

export function normalizePunctuation(text: string): string {
  if (!text) return text
  let out = text.replace(/;/g, ',')
  out = out.replace(/(.?)[ \t]*(?:\r?\n[ \t]*)+/g, (_m, prev: string) => {
    if (!prev) return ''
    if (EXISTING_PUNCT.has(prev)) return `${prev} `
    return `${prev}. `
  })
  return out.trim()
}

function splitSentences(text: string): string[] {
  const trimmed = text.trim()
  if (!trimmed) return []
  const sentences: string[] = []
  for (const para of trimmed.split(/\n\s*\n/)) {
    const p = para.trim()
    if (!p) continue
    for (const sent of p.split(SENTENCE_END)) {
      const s = sent.trim()
      if (s) sentences.push(s)
    }
  }
  return sentences
}

function packPieces(pieces: string[], maxChars: number): string[] {
  const chunks: string[] = []
  let current: string[] = []
  let currentLen = 0
  for (const piece of pieces) {
    let pieceLen = piece.length + (current.length ? 1 : 0)
    if (current.length && currentLen + pieceLen > maxChars) {
      chunks.push(current.join(' '))
      current = []
      currentLen = 0
      pieceLen = piece.length
    }
    current.push(piece)
    currentLen += pieceLen
  }
  if (current.length) chunks.push(current.join(' '))
  return chunks
}

function splitByChars(text: string, maxChars: number): string[] {
  const out: string[] = []
  for (let i = 0; i < text.length; i += maxChars) out.push(text.slice(i, i + maxChars))
  return out
}

function splitByWords(text: string, maxChars: number): string[] {
  const packed = packPieces(text.split(/\s+/).filter(Boolean), maxChars)
  const out: string[] = []
  for (const piece of packed) {
    if (piece.length <= maxChars) out.push(piece)
    else out.push(...splitByChars(piece, maxChars))
  }
  return out
}

function atomize(text: string, maxChars: number): string[] {
  const t = text.trim()
  if (!t) return []
  if (t.length <= maxChars) return [t]

  const commaParts = t.split(COMMA).map((p) => p.trim()).filter(Boolean)
  if (commaParts.length > 1) {
    const out: string[] = []
    for (const part of commaParts) out.push(...atomize(part, maxChars))
    return out
  }
  if (/\s/.test(t)) return splitByWords(t, maxChars)
  return splitByChars(t, maxChars)
}

export function chunkText(text: string, maxChunkSec = 15.0): string[] {
  const maxChars = Math.max(1, Math.floor(maxChunkSec * CHARS_PER_SEC))
  const atoms: string[] = []
  for (const sentence of splitSentences(text)) atoms.push(...atomize(sentence, maxChars))
  return packPieces(atoms, maxChars)
}

const TRAILING = /[^\p{L}\p{N}_]+$/u
const MID_PUNCT = /[^\p{L}\p{N}_\s\-/.,:?@!"'%]/gu
const REPEAT_COMMA = /\s*(?:,\s*)+/g
const END_PUNCT = new Set(['.', '!', '?'])

export function cleanSegmentPunctuation(text: string): string {
  const t = text.trim()
  if (!t) return t

  const match = t.match(TRAILING)
  const core0 = match ? t.slice(0, match.index) : t
  const trailing = match ? (match[0] ?? '').trimEnd() : ''

  const endPunct = trailing && END_PUNCT.has(trailing[trailing.length - 1])
    ? trailing[trailing.length - 1]
    : '.'

  let core = core0.replace(MID_PUNCT, ',')
  core = core.replace(REPEAT_COMMA, ', ').replace(/^[\s,]+|[\s,]+$/g, '')
  if (!core) return ''
  return core + endPunct
}

export function textSegments(text: string, maxChunkSec = 15.0): string[] {
  return chunkText(normalizePunctuation(text), maxChunkSec)
    .map(cleanSegmentPunctuation)
    .filter(Boolean)
}
