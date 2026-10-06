/**
 * Chuyển đổi dữ liệu âm thanh PCM Float32 thành định dạng WAV 16-bit PCM Mono
 */
export function createWavBuffer(audioData: Float32Array, sampleRate = 48000): Uint8Array {
  const numChannels = 1
  const bytesPerSample = 2 // 16-bit
  const blockAlign = numChannels * bytesPerSample
  const byteRate = sampleRate * blockAlign
  const dataSize = audioData.length * bytesPerSample
  const fileSize = 36 + dataSize

  const buffer = new ArrayBuffer(fileSize + 8)
  const view = new DataView(buffer)

  function writeString(offset: number, str: string) {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i))
    }
  }

  // RIFF Chunk Descriptor
  writeString(0, 'RIFF')
  view.setUint32(4, fileSize, true)
  writeString(8, 'WAVE')

  // "fmt " Sub-chunk
  writeString(12, 'fmt ')
  view.setUint32(16, 16, true) // Subchunk1Size (16 for PCM)
  view.setUint16(20, 1, true) // AudioFormat (1 for PCM)
  view.setUint16(22, numChannels, true) // NumChannels (1 mono)
  view.setUint32(24, sampleRate, true) // SampleRate (48000 Hz)
  view.setUint32(28, byteRate, true) // ByteRate
  view.setUint16(32, blockAlign, true) // BlockAlign
  view.setUint16(34, 16, true) // BitsPerSample

  // "data" Sub-chunk
  writeString(36, 'data')
  view.setUint32(40, dataSize, true)

  // Ghi PCM Data (chuyển float32 [-1, 1] sang int16)
  let offset = 44
  for (let i = 0; i < audioData.length; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, audioData[i]))
    const val = s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff)
    view.setInt16(offset, val, true)
  }

  return new Uint8Array(buffer)
}

/**
 * Chuyển đổi dữ liệu âm thanh PCM Float32 thành Base64 Data URL WAV
 */
export function createWavBase64(audioData: Float32Array, sampleRate = 48000): string {
  const bytes = createWavBuffer(audioData, sampleRate)

  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64')
  }

  if (typeof btoa !== 'undefined') {
    let binary = ''
    const len = bytes.byteLength
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i])
    }
    return btoa(binary)
  }

  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  let base64 = ''
  const len = bytes.length
  for (let i = 0; i < len; i += 3) {
    const b1 = bytes[i]
    const b2 = i + 1 < len ? bytes[i + 1] : 0
    const b3 = i + 2 < len ? bytes[i + 2] : 0

    base64 += chars[b1 >> 2]
    base64 += chars[((b1 & 3) << 4) | (b2 >> 4)]
    base64 += i + 1 < len ? chars[((b2 & 15) << 2) | (b3 >> 6)] : '='
    base64 += i + 2 < len ? chars[b3 & 63] : '='
  }

  return base64
}
