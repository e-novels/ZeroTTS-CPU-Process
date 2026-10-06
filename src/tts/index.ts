import { ProcessBridge } from './processMode/bridge'

export { ProcessBridge } from './processMode/bridge'
export { ZeroTTSEngine, CPU_COUNT, getOptimalCpuThreads } from './engine/ZeroTTSEngine'
export { BpeTokenizer } from './engine/tokenizer'
export { MossCodecDecoder } from './engine/codec'
export * from './engine/types'
export * from './engine/wavHelper'

export async function activateTTS(novel: NovelExtensionApi): Promise<void> {
  if (!novel.tts) return

  await novel.logger?.info?.('[activateTTS] Registering ZeroTTS Native Process Handlers...')

  const bridge = new ProcessBridge(novel)
  await novel.tts.register({
    getVoices: async () => bridge.getVoices(),
    speak: async (params: ExtensionTTSSpeakRequest) => bridge.speak(params),
    stop: async () => bridge.stop(),
  })

  // Register settings action for voice previewing
  if (novel.settings) {
    await novel.settings.register({
      previewVoice: async (fieldValues: Record<string, unknown>) => {
        const voiceId = typeof fieldValues.voice === 'string' ? fieldValues.voice : 'maichi'
        const previewText =
          typeof fieldValues.previewText === 'string' && fieldValues.previewText.trim()
            ? fieldValues.previewText.trim()
            : 'Xin chào, đây là giọng đọc tiếng Việt nhân tạo chất lượng cao chạy trên CPU.'

        await novel.logger?.info?.(
          `[Settings.previewVoice] Triggered with voiceId=${voiceId}, text="${previewText}"`
        )

        try {
          if (!novel.process) {
            throw new Error('novel.process is only available on Electron Desktop.')
          }
          await bridge.startProcess('bin/server')
          const result = await bridge.sendCommand('speak', {
            text: previewText,
            voiceId,
            config: fieldValues,
          })

          return {
            success: true,
            message: `Đã tổng hợp âm thanh mẫu (${voiceId})`,
            audio: result.audio,
            mimeType: result.mimeType || 'audio/wav',
          }
        } catch (err: unknown) {
          const errMsg = err instanceof Error ? err.message : String(err)
          await novel.logger?.error?.(`[Settings.previewVoice] Error: ${errMsg}`)
          return {
            success: false,
            message: errMsg,
          }
        }
      },
    })
  }
}
