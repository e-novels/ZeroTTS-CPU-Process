interface QueueItem {
  id: string
  method: string
  params: unknown
  resolve: (res: any) => void
  reject: (err: Error) => void
  timer: any
}

export class ProcessBridge {
  private processId: string | null = null
  private queue: QueueItem[] = []
  private isProcessing = false
  private pendingMap = new Map<string, QueueItem>()
  private isStarting = false

  constructor(private novel: NovelExtensionApi) {}

  private async log(message: string, ...args: any[]): Promise<void> {
    const formatted = `[ProcessBridge] ${message}`
    if (this.novel.logger?.info) {
      await this.novel.logger.info(formatted, ...args)
    } else {
      console.log(formatted, ...args)
    }
  }

  private async warn(message: string, ...args: any[]): Promise<void> {
    const formatted = `[ProcessBridge WARN] ${message}`
    if (this.novel.logger?.warn) {
      await this.novel.logger.warn(formatted, ...args)
    } else {
      console.warn(formatted, ...args)
    }
  }

  private async error(message: string, ...args: any[]): Promise<void> {
    const formatted = `[ProcessBridge ERROR] ${message}`
    if (this.novel.logger?.error) {
      await this.novel.logger.error(formatted, ...args)
    } else {
      console.error(formatted, ...args)
    }
  }

  async startProcess(executable = 'bin/server'): Promise<void> {
    if (this.processId) return
    if (this.isStarting) {
      while (this.isStarting) {
        await new Promise((r) => setTimeout(r, 50))
      }
      return
    }

    if (
      this.novel.platform !== 'win32' &&
      this.novel.platform !== 'darwin' &&
      this.novel.platform !== 'linux'
    ) {
      throw new Error('ZeroTTS Process mode is only supported on Desktop (macOS, Windows, Linux).')
    }
    if (!this.novel.process) {
      throw new Error('novel.process API is not available in this environment.')
    }

    this.isStarting = true
    try {
      let targetExec = executable
      if (this.novel.platform === 'win32') {
        targetExec = targetExec.endsWith('.bat') || targetExec.endsWith('.exe') ? targetExec : `${targetExec}.bat`
      }

      await this.log(`Spawning native process: ${targetExec}`)
      const spawnRes = await this.novel.process.spawn({ executable: targetExec })
      if (!spawnRes || !spawnRes.success) {
        throw new Error(`Failed to spawn native process executable: ${targetExec}`)
      }

      this.processId = spawnRes.processId
      await this.log(`Native process spawned successfully with processId: ${this.processId}`)

      this.novel.process.onLine(this.processId, (line: string) => {
        this.handleStdoutLine(line)
      })
    } finally {
      this.isStarting = false
    }
  }

  private handleStdoutLine(line: string): void {
    const trimmed = line.trim()
    if (!trimmed) return

    try {
      const data = JSON.parse(trimmed)
      const { id, result, error } = data
      const item = this.pendingMap.get(id)
      if (item) {
        clearTimeout(item.timer)
        this.pendingMap.delete(id)
        if (error) {
          item.reject(new Error(error))
        } else {
          item.resolve(result)
        }
      }
    } catch (err: any) {
      // Non-JSON stdout line or logging
      this.log(`[Child Output] ${trimmed}`)
    }
  }

  async sendCommand<T = any>(method: string, params: unknown, timeoutMs = 120000): Promise<T> {
    if (!this.processId) {
      await this.startProcess()
    }

    return new Promise<T>((resolve, reject) => {
      const id = Math.random().toString(36).slice(2) + Date.now().toString(36)
      const timer = setTimeout(() => {
        this.pendingMap.delete(id)
        reject(new Error(`Command ${method} timed out after ${timeoutMs}ms`))
      }, timeoutMs)

      const item: QueueItem = { id, method, params, resolve, reject, timer }
      this.queue.push(item)
      this.processNext()
    })
  }

  private async processNext(): Promise<void> {
    if (this.isProcessing || this.queue.length === 0) return
    if (!this.novel.process || !this.processId) return
    this.isProcessing = true

    const item = this.queue.shift()!
    this.pendingMap.set(item.id, item)

    const jsonStr = JSON.stringify({ id: item.id, method: item.method, params: item.params })
    try {
      await this.novel.process.writeLine(this.processId, jsonStr)
    } catch (err: any) {
      clearTimeout(item.timer)
      this.pendingMap.delete(item.id)
      item.reject(err)
    } finally {
      this.isProcessing = false
      setImmediate(() => this.processNext())
    }
  }

  async getVoices(): Promise<ExtensionTTSGetVoicesResponse> {
    await this.startProcess()
    return await this.sendCommand<ExtensionTTSGetVoicesResponse>('getVoices', {})
  }

  async speak(params: ExtensionTTSSpeakRequest): Promise<ExtensionTTSSpeakResponse> {
    await this.startProcess()
    return await this.sendCommand<ExtensionTTSSpeakResponse>('speak', params)
  }

  async stop(): Promise<ExtensionTTSStopResponse> {
    if (this.processId) {
      try {
        await this.sendCommand('stop', {})
      } catch {}
    }
    return { success: true }
  }

  async terminate(): Promise<void> {
    if (this.processId && this.novel.process) {
      await this.log(`Terminating process ${this.processId}`)
      await this.novel.process.kill(this.processId)
      this.processId = null
    }
  }
}
