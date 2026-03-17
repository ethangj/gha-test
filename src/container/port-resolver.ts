import * as path from 'path'
import * as core from '@actions/core'
import { readWireMockConfig } from '../utils/yaml-reader'

export interface ServiceUrl {
  name: string
  url: string
  port: number
}

export interface ResolvedUrls {
  primary: string
  all: Record<string, string>
  services: ServiceUrl[]
  adminUrl: string
}

/**
 * Resolves wiremock.yaml service definitions into URLs.
 * Returns the primary (first) service URL, all service URLs as a map,
 * and the runner admin URL.
 */
export function resolveUrls(
  wiremockDir: string,
  runnerAdminUrl: string,
  profile?: string
): ResolvedUrls {
  const config = readWireMockConfig(wiremockDir, profile)

  const entries = Object.entries(config.services)
  if (entries.length === 0) {
    throw new Error(
      `wiremock.yaml at ${path.join(wiremockDir, 'wiremock.yaml')} defines no services`
    )
  }

  const services: ServiceUrl[] = entries.map(([key, svc]) => ({
    name: key,
    url: `http://localhost:${svc.port}`,
    port: svc.port,
  }))

  const all: Record<string, string> = {}
  for (const svc of services) {
    all[svc.name] = svc.url
  }

  core.info(`Resolved ${services.length} service(s) from wiremock.yaml`)
  for (const svc of services) {
    core.info(`  ${svc.name}: ${svc.url}`)
  }

  return {
    primary: services[0].url,
    all,
    services,
    adminUrl: runnerAdminUrl,
  }
}

/**
 * Parses the ports input string ("8080,8081") into an array of numbers.
 */
export function parsePorts(ports: string): number[] {
  return ports
    .split(',')
    .map(p => p.trim())
    .filter(Boolean)
    .map(p => parseInt(p, 10))
}
