import * as fs from 'fs'
import * as path from 'path'
import * as yaml from 'js-yaml'

export interface ServiceDefinition {
  type?: string
  cloud_id?: number | string
  name?: string
  port: number
  originals?: Record<string, string>
}

export interface WireMockConfig {
  services: Record<string, ServiceDefinition>
}

export function readWireMockConfig(wiremockDir: string, profile?: string): WireMockConfig {
  const basePath = path.join(wiremockDir, 'wiremock.yaml')

  if (!fs.existsSync(basePath)) {
    throw new Error(
      `No wiremock.yaml found at ${basePath}. Ensure:\n` +
        `1. Your repository contains a .wiremock directory with wiremock.yaml\n` +
        `2. The checkout step ran before this Action\n` +
        `3. If using a custom path, set the wiremock-dir input`
    )
  }

  const rawBase = yaml.load(fs.readFileSync(basePath, 'utf8'))
  if (!rawBase || typeof rawBase !== 'object' || Array.isArray(rawBase)) {
    throw new Error(`wiremock.yaml at ${basePath} must be a YAML mapping, got ${Array.isArray(rawBase) ? 'array' : typeof rawBase}`)
  }
  const baseConfig = rawBase as WireMockConfig
  if (!baseConfig.services) {
    throw new Error(`wiremock.yaml at ${basePath} has no 'services' key`)
  }

  if (!profile) {
    return baseConfig
  }

  const profilePath = path.join(wiremockDir, `wiremock-${profile}.yaml`)
  if (!fs.existsSync(profilePath)) {
    throw new Error(
      `Environment profile '${profile}' not found.\n` +
        `Expected file: ${profilePath}\n` +
        `Run the environments-create command first:\n` +
        `  command: environments-create\n` +
        `  profile: ${profile}`
    )
  }

  const rawProfile = yaml.load(fs.readFileSync(profilePath, 'utf8'))
  const profileConfig: Partial<WireMockConfig> =
    rawProfile && typeof rawProfile === 'object' && !Array.isArray(rawProfile)
      ? (rawProfile as Partial<WireMockConfig>)
      : {}

  // Merge: profile overrides base service fields (except type)
  const merged: WireMockConfig = {
    services: { ...baseConfig.services },
  }

  if (profileConfig?.services) {
    for (const [key, override] of Object.entries(profileConfig.services)) {
      if (!merged.services[key]) continue // profile cannot add new services
      const base = merged.services[key]
      merged.services[key] = {
        ...base,
        ...override,
        type: base.type, // type cannot be overridden
        port: base.port, // port comes from base (actual listen port)
      }
    }
  }

  return merged
}
