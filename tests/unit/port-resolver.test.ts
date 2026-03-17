import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

jest.mock('@actions/core', () => ({
  info: jest.fn(),
}))

import { resolveUrls, parsePorts } from '../../src/container/port-resolver'

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'wm-resolver-'))
}

function writeYaml(dir: string, filename: string, content: string): void {
  fs.writeFileSync(path.join(dir, filename), content, 'utf8')
}

describe('parsePorts', () => {
  it('parses a single port', () => {
    expect(parsePorts('8080')).toEqual([8080])
  })

  it('parses multiple ports', () => {
    expect(parsePorts('8080,8081,8082')).toEqual([8080, 8081, 8082])
  })

  it('handles spaces around commas', () => {
    expect(parsePorts('8080, 8081')).toEqual([8080, 8081])
  })
})

describe('resolveUrls', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = makeTempDir()
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('resolves a single service', () => {
    writeYaml(tmpDir, 'wiremock.yaml', `
services:
  my-api:
    port: 8080
`)
    const result = resolveUrls(tmpDir, 'http://localhost:9999')
    expect(result.primary).toBe('http://localhost:8080')
    expect(result.all['my-api']).toBe('http://localhost:8080')
    expect(result.adminUrl).toBe('http://localhost:9999')
  })

  it('resolves multiple services, primary is first', () => {
    writeYaml(tmpDir, 'wiremock.yaml', `
services:
  invoicing-api:
    port: 8080
  payment-api:
    port: 8081
`)
    const result = resolveUrls(tmpDir, 'http://localhost:9999')
    expect(result.primary).toBe('http://localhost:8080')
    expect(result.all['invoicing-api']).toBe('http://localhost:8080')
    expect(result.all['payment-api']).toBe('http://localhost:8081')
    expect(result.services).toHaveLength(2)
  })

  it('applies profile overlay when provided', () => {
    writeYaml(tmpDir, 'wiremock.yaml', `
services:
  my-api:
    cloud_id: 100
    port: 8080
`)
    writeYaml(tmpDir, 'wiremock-staging.yaml', `
services:
  my-api:
    cloud_id: 200
`)
    const result = resolveUrls(tmpDir, 'http://localhost:9999', 'staging')
    expect(result.primary).toBe('http://localhost:8080')
  })

  it('throws when services is empty', () => {
    writeYaml(tmpDir, 'wiremock.yaml', `
services: {}
`)
    expect(() => resolveUrls(tmpDir, 'http://localhost:9999')).toThrow(/no services/)
  })
})
