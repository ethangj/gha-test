import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { readWireMockConfig } from '../../src/utils/yaml-reader'

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'wm-test-'))
}

function writeYaml(dir: string, filename: string, content: string): void {
  fs.writeFileSync(path.join(dir, filename), content, 'utf8')
}

describe('readWireMockConfig', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = makeTempDir()
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('reads a minimal valid wiremock.yaml', () => {
    writeYaml(tmpDir, 'wiremock.yaml', `
services:
  my-api:
    port: 8080
`)
    const config = readWireMockConfig(tmpDir)
    expect(config.services['my-api'].port).toBe(8080)
  })

  it('reads multiple services', () => {
    writeYaml(tmpDir, 'wiremock.yaml', `
services:
  invoicing-api:
    type: cloud
    cloud_id: 123
    port: 8080
  payment-api:
    type: cloud
    cloud_id: 456
    port: 8081
`)
    const config = readWireMockConfig(tmpDir)
    expect(Object.keys(config.services)).toHaveLength(2)
    expect(config.services['invoicing-api'].port).toBe(8080)
    expect(config.services['payment-api'].port).toBe(8081)
  })

  it('throws when wiremock.yaml is missing', () => {
    expect(() => readWireMockConfig(tmpDir)).toThrow(/No wiremock\.yaml found/)
  })

  it('throws when wiremock.yaml has no services key', () => {
    writeYaml(tmpDir, 'wiremock.yaml', 'foo: bar')
    expect(() => readWireMockConfig(tmpDir)).toThrow(/no 'services' key/)
  })

  it('applies profile overlay', () => {
    writeYaml(tmpDir, 'wiremock.yaml', `
services:
  my-api:
    type: cloud
    cloud_id: 100
    port: 8080
`)
    writeYaml(tmpDir, 'wiremock-staging.yaml', `
services:
  my-api:
    cloud_id: 200
`)
    const config = readWireMockConfig(tmpDir, 'staging')
    expect(config.services['my-api'].cloud_id).toBe(200)
  })

  it('profile cannot override type', () => {
    writeYaml(tmpDir, 'wiremock.yaml', `
services:
  my-api:
    type: cloud
    port: 8080
`)
    writeYaml(tmpDir, 'wiremock-staging.yaml', `
services:
  my-api:
    type: local
`)
    const config = readWireMockConfig(tmpDir, 'staging')
    expect(config.services['my-api'].type).toBe('cloud')
  })

  it('profile cannot override port', () => {
    writeYaml(tmpDir, 'wiremock.yaml', `
services:
  my-api:
    port: 8080
`)
    writeYaml(tmpDir, 'wiremock-staging.yaml', `
services:
  my-api:
    port: 9090
`)
    const config = readWireMockConfig(tmpDir, 'staging')
    expect(config.services['my-api'].port).toBe(8080)
  })

  it('profile cannot add new services', () => {
    writeYaml(tmpDir, 'wiremock.yaml', `
services:
  my-api:
    port: 8080
`)
    writeYaml(tmpDir, 'wiremock-staging.yaml', `
services:
  my-api:
    cloud_id: 999
  extra-api:
    port: 9090
`)
    const config = readWireMockConfig(tmpDir, 'staging')
    expect(Object.keys(config.services)).toHaveLength(1)
    expect(config.services['extra-api']).toBeUndefined()
  })

  it('throws when profile file is missing', () => {
    writeYaml(tmpDir, 'wiremock.yaml', `
services:
  my-api:
    port: 8080
`)
    expect(() => readWireMockConfig(tmpDir, 'missing-profile')).toThrow(/not found/)
  })

  it('returns base config when no profile provided', () => {
    writeYaml(tmpDir, 'wiremock.yaml', `
services:
  my-api:
    cloud_id: 100
    port: 8080
`)
    const config = readWireMockConfig(tmpDir)
    expect(config.services['my-api'].cloud_id).toBe(100)
  })
})
