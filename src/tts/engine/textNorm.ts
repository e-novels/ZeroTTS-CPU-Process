/**
 * Vietnamese text normalization for ZeroTTS.
 * Port of zerotts/text_norm/vi_normalizer.py.
 */

let nodeFs: any = null
let nodePath: any = null
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  nodeFs = typeof require === 'function' ? require('node:fs') || require('fs') : null
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  nodePath = typeof require === 'function' ? require('node:path') || require('path') : null
} catch {
  nodeFs = null
  nodePath = null
}

const DIGIT: Record<string, string> = {
  '0': 'không', '1': 'một', '2': 'hai', '3': 'ba', '4': 'bốn',
  '5': 'năm', '6': 'sáu', '7': 'bảy', '8': 'tám', '9': 'chín',
  ',': 'phẩy',
}

const UNIT_SINGLE = ['', 'mươi', 'trăm']
const UNIT_TRIPLE = ['', 'nghìn', 'triệu', 'tỷ', 'nghìn tỷ', 'triệu tỷ', 'tỷ tỷ']
const OP_WORDS: Record<string, string> = {
  '+': 'cộng', '-': 'trừ', '*': 'nhân', '/': 'chia', '^': 'mũ',
}

function applySandhi(text: string): string {
  return text
    .replace(/mười năm/g, 'mười lăm')
    .replace(/mươi năm/g, 'mươi lăm')
    .replace(/mươi bốn/g, 'mươi tư')
    .replace(/mươi một/g, 'mươi mốt')
    .replace(/linh bốn/g, 'linh tư')
}

export function expandDigit(digits: string): string {
  return [...digits.replace(/ /g, '')].map((c) => DIGIT[c] ?? c).join(' ')
}

function splitChunks(number: string): string[] {
  const chunks: string[] = []
  for (let i = number.length - 3; i >= 0; i -= 3) chunks.push(number.slice(i, i + 3))
  chunks.reverse()
  if (number.length % 3) chunks.unshift(number.slice(0, number.length % 3))
  return chunks
}

class TooLarge extends Error {}

function speakChunk(chunk: string, scaleIndex: number): string {
  if (chunk === '000') return ''

  let result = ''
  for (let pos = chunk.length - 1; pos >= 0; pos--) {
    if (pos === chunk.length - 1 && chunk[pos] === '0' && chunk.length > 1) {
      // trailing zero
    } else if (pos === chunk.length - 2 && (chunk[pos] === '1' || chunk[pos] === '0')) {
      if (pos === 0 && chunk[pos] === '0') {
        // leading zero
      } else if (chunk[pos] === '1') {
        result = chunk[pos + 1] !== '0' ? `mười ${DIGIT[chunk[pos + 1]]}` : 'mười'
      } else {
        result = chunk[pos + 1] !== '0' ? `linh ${DIGIT[chunk[pos + 1]]}` : ''
      }
    } else {
      result = DIGIT[chunk[pos]] + ' ' + UNIT_SINGLE[chunk.length - pos - 1]
        + (result ? ' ' + result : '')
    }
  }

  if (scaleIndex >= UNIT_TRIPLE.length) throw new TooLarge()
  return [result.trim(), UNIT_TRIPLE[scaleIndex]].join(' ').trim()
}

export function expandNumber(number: string): string {
  const original = number
  try {
    let sign = ''
    if (number[0] === '-' || number[0] === '+') {
      sign = number[0] === '+' ? 'cộng' : 'trừ'
      number = number.slice(1)
    }
    while (number.length > 1 && number[0] === '0' && /\d/.test(number[1])) {
      number = number.slice(1)
    }
    number = number.trim()

    const matches = number.match(/[-+]?[0-9.,]+/g) ?? []
    if (matches.length > 1 || (matches.length === 1 && matches[0] !== number)) {
      return number
        .replace(/\s*([-+]?[0-9.,]+)\s*/g, (_m, n: string) => ` ${expandNumber(n)} `)
        .trim()
        .replace(/[-+*/^]/g, (c) => OP_WORDS[c] ?? c)
    }

    number = number.replace(/[^0-9.,]/g, '')

    const count = (s: string, c: string) => [...s].filter((x) => x === c).length
    let decimalPart = ''
    if (count(number, ',') === 1) {
      number = number.replace(/\./g, '')
      const parts = number.split(',')
      decimalPart = `phẩy ${expandDigit(parts[parts.length - 1])}`
      number = parts.slice(0, -1).join('')
    } else if (count(number, '.') === 1 && number.slice(number.indexOf('.')).length <= 3) {
      number = number.replace(/,/g, '')
      const parts = number.split('.')
      decimalPart = `chấm ${expandDigit(parts[parts.length - 1])}`
      number = parts.slice(0, -1).join('')
    } else {
      number = number.replace(/\./g, '')
    }

    const chunks = splitChunks(number)
    const spoken: string[] = []
    chunks.forEach((chunk, i) => {
      const part = speakChunk(chunk, chunks.length - i - 1)
      if (part) spoken.push(part)
    })

    return `${sign} ${applySandhi(spoken.join(' '))} ${decimalPart}`.replace(/\s+/g, ' ').trim()
  } catch (err) {
    if (err instanceof TooLarge) return expandDigit(original)
    throw err
  }
}

const num = (v: string) => expandNumber(v)
const month = (v: string) => (v.replace(/^0+/, '') === '4' ? 'tư' : expandNumber(v))

let abbreviations: Map<string, string> | null = null

const DEFAULT_ABBR_FALLBACK: Record<string, string> = {
  TP: 'thành phố',
  TX: 'thị xã',
  TT: 'thị trấn',
  KP: 'khu phố',
  Q: 'quận',
  P: 'phường',
  H: 'huyện',
  HCM: 'Hồ Chí Minh',
  HN: 'Hà Nội',
  ĐHQG: 'đại học quốc gia',
  UBND: 'ủy ban nhân dân',
  HĐND: 'hội đồng nhân dân',
  BCH: 'ban chấp hành',
  ATGT: 'an toàn giao thông',
  CSGT: 'cảnh sát giao thông',
  USD: 'đô la Mỹ',
  VND: 'Việt Nam đồng',
  VN: 'Việt Nam'
}

export function setAbbreviationsContent(raw: string): void {
  const table = new Map<string, string>()
  for (const [k, v] of Object.entries(DEFAULT_ABBR_FALLBACK)) {
    table.set(k, v)
  }
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes(':')) continue
    const idx = trimmed.indexOf(':')
    const abbr = trimmed.slice(0, idx)
    if (!table.has(abbr)) table.set(abbr, trimmed.slice(idx + 1).split(',')[0])
  }
  abbreviations = table
}

export function loadAbbreviations(): Map<string, string> {
  if (abbreviations) return abbreviations
  const table = new Map<string, string>()

  for (const [k, v] of Object.entries(DEFAULT_ABBR_FALLBACK)) {
    table.set(k, v)
  }

  if (nodeFs) {
    const candidates = [
      './model/abbreviations.txt',
      './models/abbreviations.txt',
      '../model/abbreviations.txt',
      nodePath ? nodePath.join(__dirname, '../../model/abbreviations.txt') : ''
    ].filter(Boolean)

    for (const c of candidates) {
      try {
        if (nodeFs.existsSync(c)) {
          const raw = nodeFs.readFileSync(c, 'utf8')
          for (const line of raw.split(/\r?\n/)) {
            const trimmed = line.trim()
            if (!trimmed || trimmed.startsWith('#') || !trimmed.includes(':')) continue
            const idx = trimmed.indexOf(':')
            const abbr = trimmed.slice(0, idx)
            if (!table.has(abbr)) table.set(abbr, trimmed.slice(idx + 1).split(',')[0])
          }
          break
        }
      } catch {}
    }
  }

  abbreviations = table
  return table
}

function expandAbbreviation(token: string): string | null {
  const table = loadAbbreviations()
  for (const key of [token, token.replace(/[.-]/g, '')]) {
    const hit = table.get(key)
    if (hit) return hit
  }
  const parts = token.split(/[.-]/).filter(Boolean)
  if (parts.length > 1 && parts.every((p) => p.length >= 2 && table.has(p))) {
    return parts.map((p) => table.get(p)!).join(' ')
  }
  return null
}

const VN_UPPER = 'A-ZÀÁÂÃÈÉÊÌÍÒÓÔÕÙÚÝĂĐĨŨƠƯẠ-Ỹ'
const VN_LOWER = 'a-zàáâãèéêìíòóôõùúýăđĩũơưạ-ỹ'
const DATE_CUES = 'ngày|mùng|mồng|hôm|sáng|trưa|chiều|tối|đêm|từ|đến|và|hoặc'
const PREFIX_ABBR = 'TP|TX|TT|KP|[QPH]'

const ROMAN: Record<string, string> = {
  I: 'một', II: 'hai', III: 'ba', IV: 'bốn', V: 'năm',
  VI: 'sáu', VII: 'bảy', VIII: 'tám', IX: 'chín', X: 'mười',
}

const ROMAN_CUES = ['quý', 'thứ', 'khóa', 'kỳ', 'đợt', 'loại', 'chương', 'phần', 'thế kỷ']

const spellLetters = (letters: string) => letters.toUpperCase()

const isUp = (c: string) => !!c && c !== c.toLowerCase() && c === c.toUpperCase()
const isLow = (c: string) => !!c && c !== c.toUpperCase() && c === c.toLowerCase()

export function splitCamelCase(text: string): string {
  return text.split(/(\s+)/).map((token) => {
    if (!token || /^\s+$/.test(token)) return token
    const chars = [...token]
    if (!(chars.some(isUp) && chars.some(isLow))) return token
    const out: string[] = []
    let lowerRun = 0
    for (let i = 0; i < chars.length; i++) {
      const c = chars[i]
      if (isUp(c) && i > 0) {
        let run = 0
        while (i + run < chars.length && isUp(chars[i + run])) run++
        if (lowerRun >= 2 && run >= 2) out.push(' ')
        else if (isUp(chars[i - 1]) && isLow(chars[i + 1] ?? '')) out.push(' ')
      }
      lowerRun = isLow(c) ? lowerRun + 1 : 0
      out.push(c)
    }
    return out.join('')
  }).join('')
}

const PROTECTED = new RegExp(
  [
    '(?:https?|ftp)://\\S+',
    'www\\.\\S+',
    '[\\w.+-]+@[\\w-]+(?:\\.[\\w-]+)+',
    '\\b[\\w-]+(?:\\.[\\w-]+)*\\.(?:com|net|org|vn|io|edu|gov|info|dev|ai)\\b(?:/\\S*)?',
  ].join('|'),
  'gi',
)

const SCANNER = new RegExp([
  String.raw`(?<![\d:])(?<t_h>[01]?\d|2[0-3])[:hg](?<t_m>[0-5]?\d)[:mp](?<t_s>[0-5]?\d)(?![\d:])`,
  String.raw`(?<![\d/.\-])(?<d_d>0?[1-9]|[12]\d|3[01])(?<d_sep>[/.\-])(?<d_m>0?[1-9]|1[0-2])\k<d_sep>(?<d_y>[12]\d{3})(?![\d/-])(?!\.\d)`,
  String.raw`(?<![\d/.\-])(?<my_m>0?[1-9]|1[0-2])[/\-](?<my_y>1\d{3}|20\d{2}|21\d{2})(?![\d/-])(?!\.\d)`,
  String.raw`(?<=\b)(?<dm_cue>${DATE_CUES})(?<dm_gap>\s+)(?<dm_d>0?[1-9]|[12]\d|3[01])[/\-](?<dm_m>0?[1-9]|1[0-2])(?![\d/-])(?!\.\d)`,
  String.raw`(?<![\d:])(?<hm_h>[01]?\d|2[0-3]):(?<hm_m>[0-5]\d)(?![\d:])`,
  String.raw`(?<![\d:])(?<hg_h>[01]?\d|2[0-3])[hg](?<hg_m>[0-5]\d)(?![\dhg])`,
  String.raw`(?<![\d:])(?<h_h>[01]?\d|2[0-3])[hg](?!\w)`,
  String.raw`(?<![\w.])(?<vp>[vV])(?<v_num>\d+(?:\.\d+)+)(?!\w|\.\d|,\d)`,
  String.raw`(?<![\w.,])(?<v_bare>\d+(?:\.\d+){2,})(?!\w|\.\d|,\d)`,
  String.raw`(?<![\w/.,])(?<f_a>\d+)\s*/\s*(?<f_b>\d+)(?![\w/,])(?!\.\d)`,
  String.raw`(?<![\w.,])(?<deg_n>-?\d[\d.,]*)\s*°\s*(?<deg_u>[CF])?(?![${VN_LOWER}])`,
  String.raw`(?<![\w.,])(?<pct_num>[-+]?\d[\d.,]*?)\s*%(?!\w)`,
  String.raw`(?<![\w.,])(?<n_num>[-+]?\d[\d.,]*(?:\s*[*^+]\s*[-+]?\d[\d.,]*|\s+[-/]\s+[-+]?\d[\d.,]*|[*^]\s*[-+]?\d[\d.,]*)*)(?![.,]?\d)`,
  String.raw`(?<![\w.])(?<pfx>${PREFIX_ABBR})\.(?=\s+[${VN_UPPER}])`,
  String.raw`(?<![\w/])(?<ap>[${VN_UPPER}]{1,6}/[${VN_UPPER}]{1,6})(?![\w/])`,
  String.raw`(?<![\w-])(?<code_a>[${VN_UPPER}]{1,4})-?(?<code_n>\d{1,6})(?![\w-])`,
  String.raw`(?<![\w.])(?<abbr>[${VN_UPPER}][${VN_UPPER}\d]+(?:\.[${VN_UPPER}][${VN_UPPER}\d]*)*)(?![${VN_LOWER}\d])`,
  String.raw`(?<at>@)`,
].join('|'), 'gu')

const THOUSANDS = /^\d{1,3}(?:\.\d{3})+$/
const NUM_TRAIL = /[.,\s]+$/

function speakTime(h: string, m?: string, s?: string): string {
  let out = `${num(h)} giờ`
  if (m != null && (s != null || m.replace(/0/g, '') !== '')) {
    out += ` ${num(m)} phút`
  }
  if (s != null) out += ` ${num(s)} giây`
  return out
}

function expandMatch(m: RegExpExecArray): string {
  const g = (m.groups ?? {}) as Record<string, string | undefined>
  const whole = m[0]

  if (g.t_h !== undefined) return speakTime(g.t_h, g.t_m, g.t_s)
  if (g.d_d !== undefined) {
    return `${num(g.d_d)} tháng ${month(g.d_m!)} năm ${num(g.d_y!)}`
  }
  if (g.my_m !== undefined) {
    const before = m.input.slice(Math.max(0, m.index - 8), m.index).toLowerCase()
    const lead = /tháng\s*$/.test(before) ? '' : 'tháng '
    return `${lead}${month(g.my_m)} năm ${num(g.my_y!)}`
  }
  if (g.pfx !== undefined) return expandAbbreviation(g.pfx) ?? g.pfx
  if (g.ap !== undefined) return g.ap
  if (g.code_a !== undefined) {
    return `${spellLetters(g.code_a)} ${g.code_n!.split('').join(' ')}`
  }
  if (g.deg_n !== undefined) {
    const unit = g.deg_u === 'C' ? ' xê' : g.deg_u === 'F' ? ' ép' : ''
    return `${expandNumber(g.deg_n)} độ${unit}`
  }
  if (g.dm_d !== undefined) {
    const cue = g.dm_cue!.toLowerCase()
    if (cue === 'và' || cue === 'hoặc') {
      const before = m.input.slice(Math.max(0, m.index - 40), m.index).toLowerCase()
      if (!new RegExp(`\\b(?:${DATE_CUES})\\b`, 'u').test(before)) return whole
    }
    return `${g.dm_cue}${g.dm_gap}${num(g.dm_d)} tháng ${month(g.dm_m!)}`
  }
  if (g.hm_h !== undefined) return speakTime(g.hm_h, g.hm_m)
  if (g.hg_h !== undefined) return speakTime(g.hg_h, g.hg_m)
  if (g.h_h !== undefined) return speakTime(g.h_h)
  if (g.v_num !== undefined) {
    return `${g.vp} ${g.v_num.split('.').map(num).join(' chấm ')}`
  }
  if (g.v_bare !== undefined) {
    if (THOUSANDS.test(g.v_bare)) return expandNumber(g.v_bare)
    return g.v_bare.split('.').map(num).join(' chấm ')
  }
  if (g.f_a !== undefined) return `${num(g.f_a)} trên ${num(g.f_b!)}`
  if (g.pct_num !== undefined) {
    return `${expandNumber(g.pct_num.replace(/[.,]+$/, ''))} phần trăm`
  }
  if (g.n_num !== undefined) {
    let raw = g.n_num
    let suffix = ''
    const trail = NUM_TRAIL.exec(raw)
    if (trail && !raw.slice(trail.index).replace(/ /g, '').replace(/[.,]+$/, '')) {
      suffix = raw.slice(trail.index)
      raw = raw.slice(0, trail.index)
    }
    if (!raw) return whole
    if (/^[-+]?\d+$/.test(raw) && raw.replace(/^[-+]/, '').length > 8) return whole
    if (/^[^\W\d_]\d/u.test(m.input.slice(m.index + whole.length, m.index + whole.length + 2))) {
      return whole
    }
    return expandNumber(raw) + suffix
  }
  if (g.abbr !== undefined) {
    const token = g.abbr
    if (token in ROMAN) {
      const before = m.input.slice(Math.max(0, m.index - 12), m.index).toLowerCase()
      if (ROMAN_CUES.some((cue) => new RegExp(`${cue}\\s*$`).test(before))) return ROMAN[token]
    }
    const expansion = expandAbbreviation(token)
    if (expansion !== null) {
      const back = m.input.slice(Math.max(0, m.index - expansion.length - 4), m.index)
      if (back.trimEnd().endsWith('(') && back.toLowerCase().includes(expansion.toLowerCase())) {
        return spellLetters(token)
      }
    }
    return expansion ?? token
  }
  if (g.at !== undefined) return 'a còng'
  return whole
}

const isAlnum = (c: string) => !!c && /[\p{L}\p{N}]/u.test(c)

function scan(text: string): string {
  SCANNER.lastIndex = 0
  let out = ''
  let last = 0
  let m: RegExpExecArray | null
  while ((m = SCANNER.exec(text)) !== null) {
    if (m[0] === '') { SCANNER.lastIndex++; continue }
    let expanded = expandMatch(m)
    if (expanded !== m[0]) {
      const before = m.index > 0 ? text[m.index - 1] : ''
      const after = text[m.index + m[0].length] ?? ''
      if (isAlnum(before) && !/^\s/.test(expanded)) expanded = ' ' + expanded
      if (isAlnum(after) && !/\s$/.test(expanded)) expanded = expanded + ' '
    }
    out += text.slice(last, m.index) + expanded
    last = m.index + m[0].length
  }
  return out + text.slice(last)
}

export function normalizeViText(text: string): string {
  if (!text || !text.trim()) return text

  text = text.normalize('NFC')

  const out: string[] = []
  let last = 0
  PROTECTED.lastIndex = 0
  let p: RegExpExecArray | null
  while ((p = PROTECTED.exec(text)) !== null) {
    out.push(scan(splitCamelCase(text.slice(last, p.index))))
    out.push(p[0])
    last = p.index + p[0].length
  }
  out.push(scan(splitCamelCase(text.slice(last))))

  return out.join('').replace(/[ \t]{2,}/g, ' ')
}
