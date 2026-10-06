import { initExtensionApi, logger } from './utilities'
import { activateTTS } from './tts'

export * from './utilities'
export * from './tts'

export async function activate(novel: NovelExtensionApi): Promise<void> {
  initExtensionApi(novel)
  await activateTTS(novel)
  await logger.info(`Activated ${novel.extension.id}`)
}

export async function deactivate(): Promise<void> {
  return
}
