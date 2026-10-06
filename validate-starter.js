'use strict'

const fs = require('node:fs')
const path = require('node:path')

const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, 'extension.json'), 'utf8'))
const kind = manifest.starter?.kind
const permissions = Array.isArray(manifest.permissions) ? manifest.permissions : []
const contributes = manifest.contributes || {}
const allowedPermissions = new Set([
  'network',
  'storage',
  'ui.theme',
  'ui.sidebar',
  'reader',
  'tts',
  'translate',
  'process'
])
const scraperCapabilities = new Set([
  'search',
  'getBookDetail',
  'getChapter',
  'getFilterOptions',
  'suggest',
  'getComments',
  'getReviews',
  'download'
])
const filterTypes = new Set(['text', 'select', 'multi-select', 'radio', 'checkbox', 'number', 'date'])

function fail(message) {
  throw new Error(`Invalid starter profile: ${message}`)
}

function requireString(value, field) {
  if (typeof value !== 'string' || !value.trim()) fail(`${field} must be a non-empty string.`)
}

function requireRelativePath(value, field) {
  requireString(value, field)
  const normalized = value.replace(/\\/g, '/')
  if (normalized.includes('..') || normalized.startsWith('/')) {
    fail(`${field} must be a safe relative path.`)
  }
}

function validateManifestBasics() {
  if (!/^[a-z0-9-]+$/.test(manifest.name || '')) {
    fail('name must use lowercase letters, digits, and hyphens only.')
  }
  if (!/^\d+\.\d+\.\d+(?:-[\w.]+)?$/.test(manifest.version || '')) {
    fail('version must be a valid semver value such as "1.0.0".')
  }
  if (!manifest.engines || typeof manifest.engines !== 'object' || typeof manifest.engines.enovel !== 'string') {
    fail('engines.enovel must declare a compatible e-novels version.')
  }
  requireRelativePath(manifest.main, 'main')
  requireRelativePath(manifest.browser, 'browser')
  requireRelativePath(manifest.icon, 'icon')
  if (!Array.isArray(manifest.activationEvents) || manifest.activationEvents.length === 0) {
    fail('activationEvents must be a non-empty array.')
  }
  if (!Array.isArray(manifest.permissions)) fail('permissions must be an array.')
  for (const permission of permissions) {
    if (!allowedPermissions.has(permission)) fail(`permissions contains unsupported value "${permission}".`)
  }
}

function validateScraperContribution(scraper) {
  if (!scraper || typeof scraper !== 'object') fail('contributes.scraper must be an object.')
  requireString(scraper.name, 'contributes.scraper.name')
  if (scraper.version !== 2) fail('contributes.scraper.version must equal 2.')
  if (!scraper.site || typeof scraper.site !== 'object') fail('contributes.scraper.site must be an object.')
  requireString(scraper.site.name, 'contributes.scraper.site.name')
  let baseUrl
  try {
    baseUrl = new URL(scraper.site.baseUrl)
  } catch {
    fail('contributes.scraper.site.baseUrl must be an absolute HTTP(S) URL.')
  }
  if (!['http:', 'https:'].includes(baseUrl.protocol)) {
    fail('contributes.scraper.site.baseUrl must use HTTP(S).')
  }
  if (!Array.isArray(manifest.network?.allowedHosts) || manifest.network.allowedHosts.length === 0) {
    fail('network.allowedHosts must be a non-empty array for scraper extensions.')
  }
  const hosts = new Set()
  for (const host of manifest.network.allowedHosts) {
    if (typeof host !== 'string' || !/^[a-z0-9.-]+$/i.test(host) || host.includes('*')) {
      fail(`network.allowedHosts contains invalid host "${String(host)}".`)
    }
    hosts.add(host.toLowerCase())
  }
  if (!hosts.has(baseUrl.hostname.toLowerCase())) {
    fail(`network.allowedHosts must include "${baseUrl.hostname}" from contributes.scraper.site.baseUrl.`)
  }
  if (!Array.isArray(scraper.capabilities) || scraper.capabilities.length === 0) {
    fail('contributes.scraper.capabilities must be a non-empty array.')
  }
  const capabilities = new Set()
  for (const capability of scraper.capabilities) {
    if (!scraperCapabilities.has(capability)) fail(`unsupported scraper capability "${String(capability)}".`)
    if (capabilities.has(capability)) fail(`scraper capability "${capability}" is duplicated.`)
    capabilities.add(capability)
  }
  for (const capability of ['search', 'getBookDetail', 'getChapter']) {
    if (!capabilities.has(capability)) fail(`scraper capability "${capability}" is required.`)
  }
  const search = scraper.search
  if (!search || typeof search !== 'object') fail('contributes.scraper.search must be an object.')
  if (!Number.isInteger(search.pageSize) || search.pageSize < 1 || search.pageSize > 100) {
    fail('contributes.scraper.search.pageSize must be an integer from 1 to 100.')
  }
  if (!Array.isArray(search.fields)) fail('contributes.scraper.search.fields must be an array.')
  const fieldIds = new Set()
  for (const [index, field] of search.fields.entries()) {
    const fieldPath = `contributes.scraper.search.fields[${index}]`
    if (!field || typeof field !== 'object') fail(`${fieldPath} must be an object.`)
    if (typeof field.id !== 'string' || !/^[a-z][a-z0-9-]*$/i.test(field.id)) {
      fail(`${fieldPath}.id must be a valid identifier.`)
    }
    if (fieldIds.has(field.id)) fail(`${fieldPath}.id duplicates "${field.id}".`)
    fieldIds.add(field.id)
    requireString(field.label, `${fieldPath}.label`)
    if (!filterTypes.has(field.type)) fail(`${fieldPath}.type is not supported.`)
    if (field.optionsMethod && !capabilities.has('getFilterOptions')) {
      fail(`${fieldPath}.optionsMethod requires capability "getFilterOptions".`)
    }
    if (field.suggestMethod && !capabilities.has('suggest')) {
      fail(`${fieldPath}.suggestMethod requires capability "suggest".`)
    }
  }
  for (const field of search.fields) {
    if (field.dependsOn && !fieldIds.has(field.dependsOn)) {
      fail(`search field "${field.id}" depends on unknown field "${field.dependsOn}".`)
    }
  }
}

function validateTTSContribution(tts) {
  if (!tts || typeof tts !== 'object') fail('contributes.tts must be an object.')
  requireString(tts.name, 'contributes.tts.name')
  if (!Array.isArray(tts.capabilities) || tts.capabilities.length === 0) {
    fail('contributes.tts.capabilities must be a non-empty array.')
  }
  const validCaps = new Set(['getVoices', 'speak', 'stop'])
  for (const cap of tts.capabilities) {
    if (!validCaps.has(cap)) fail(`unsupported TTS capability "${String(cap)}".`)
  }
  if (!tts.capabilities.includes('getVoices')) fail('contributes.tts.capabilities must include "getVoices".')
  if (!tts.capabilities.includes('speak')) fail('contributes.tts.capabilities must include "speak".')

  const mode = tts.mode || 'process'
  if (!['process', 'cloud', 'wasm'].includes(mode)) {
    fail('contributes.tts.mode must be "process", "cloud", or "wasm".')
  }

  if (tts.resources !== undefined) {
    if (!Array.isArray(tts.resources)) {
      fail('contributes.tts.resources must be an array.')
    }
    for (let i = 0; i < tts.resources.length; i++) {
      const res = tts.resources[i]
      if (!res || typeof res !== 'object') {
        fail(`contributes.tts.resources[${i}] is invalid.`)
      }
      if (!res.url || typeof res.url !== 'string' || !res.url.startsWith('https://')) {
        fail(`contributes.tts.resources[${i}].url must be a valid HTTPS url.`)
      }
      requireRelativePath(res.path, `contributes.tts.resources[${i}].path`)
      if (typeof res.size !== 'number' || res.size <= 0) {
        fail(`contributes.tts.resources[${i}].size must be a positive number in bytes.`)
      }
      if (typeof res.sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(res.sha256)) {
        fail(`contributes.tts.resources[${i}].sha256 must be a valid sha256 hex string (64 characters).`)
      }
    }
  }
}

function validateTranslatorContribution(translator) {
  if (!translator || typeof translator !== 'object') fail('contributes.translator must be an object.')
  requireString(translator.name, 'contributes.translator.name')
  if (!Array.isArray(translator.capabilities) || translator.capabilities.length === 0) {
    fail('contributes.translator.capabilities must be a non-empty array.')
  }
  const validCaps = new Set(['translate', 'getLanguages'])
  for (const cap of translator.capabilities) {
    if (!validCaps.has(cap)) fail(`unsupported translator capability "${String(cap)}".`)
  }
  if (!translator.capabilities.includes('translate')) fail('contributes.translator.capabilities must include "translate".')
}

function validateThemeContributions() {
  if (contributes.themes === undefined) return
  if (!Array.isArray(contributes.themes)) fail('contributes.themes must be an array.')
  for (const [index, theme] of contributes.themes.entries()) {
    const themePath = `contributes.themes[${index}]`
    if (!theme || typeof theme !== 'object') fail(`${themePath} must be an object.`)
    requireString(theme.id, `${themePath}.id`)
    requireString(theme.label, `${themePath}.label`)
    if (theme.uiTheme !== 'light' && theme.uiTheme !== 'dark') {
      fail(`${themePath}.uiTheme must be "light" or "dark".`)
    }
    requireRelativePath(theme.path, `${themePath}.path`)
  }
}

if (kind !== 'scraper' && kind !== 'theme' && kind !== 'tts' && kind !== 'translator') {
  fail('starter.kind must be "scraper", "theme", "tts", or "translator".')
}
validateManifestBasics()
if (['scraper', 'themes', 'tts', 'translator'].filter(k => k in contributes).length > 1) {
  fail('declare only one primary contribution among scraper, themes, tts, or translator.')
}

if (kind === 'scraper') {
  if (!contributes.scraper) fail('scraper profile requires contributes.scraper.')
  if (contributes.themes || contributes.tts || contributes.translator) fail('scraper profile must not declare other contributions.')
  if (!permissions.includes('network') || !permissions.includes('reader')) {
    fail('scraper profile requires network and reader permissions.')
  }
  if (permissions.includes('ui.theme')) fail('scraper profile must not request ui.theme.')
  validateScraperContribution(contributes.scraper)
} else if (kind === 'tts') {
  if (!contributes.tts) fail('tts profile requires contributes.tts.')
  if (contributes.themes || contributes.scraper || contributes.translator) fail('tts profile must not declare other contributions.')
  if (!permissions.includes('tts')) {
    fail('tts profile requires the tts permission.')
  }
  validateTTSContribution(contributes.tts)
} else if (kind === 'translator') {
  if (!contributes.translator) fail('translator profile requires contributes.translator.')
  if (contributes.themes || contributes.scraper || contributes.tts) fail('translator profile must not declare other contributions.')
  if (!permissions.includes('translate')) {
    fail('translator profile requires the translate permission.')
  }
  validateTranslatorContribution(contributes.translator)
} else {
  if (contributes.scraper || contributes.tts || contributes.translator) fail('theme profile must not declare scraper, tts, or translator.')
  if (!permissions.includes('ui.theme')) fail('theme profile requires the ui.theme permission.')
  if (permissions.includes('network') || permissions.includes('reader')) {
    fail('theme profile must not request network or reader permissions.')
  }
  validateThemeContributions()
}

console.log(`[${manifest.displayName || manifest.name}] ${kind} profile validated`)