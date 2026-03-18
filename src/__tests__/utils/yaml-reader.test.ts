import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { readWireMockConfig } from '../../utils/yaml-reader'

let tmpDir: string

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-test-'))
})

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

function writeYaml(name: string, content: string) {
  fs.writeFileSync(path.join(tmpDir, name), content, 'utf8')
}

const BASE_YAML = `
services:
  todos-api:
    type: REST
    cloud_id: k5qm0
    name: GHA Test
    port: 8080
    originals:
      default: https://jsonplaceholder.typicode.com
`

describe('readWireMockConfig', () => {
  it('reads a valid wiremock.yaml', () => {
    writeYaml('wiremock.yaml', BASE_YAML)
    const config = readWireMockConfig(tmpDir)
    expect(config.services['todos-api']).toMatchObject({
      type: 'REST',
      port: 8080,
    })
  })

  it('throws when wiremock.yaml is missing', () => {
    expect(() => readWireMockConfig(tmpDir)).toThrow('No wiremock.yaml found')
  })

  it('throws when wiremock.yaml has no services key', () => {
    writeYaml('wiremock.yaml', 'foo: bar\n')
    expect(() => readWireMockConfig(tmpDir)).toThrow("has no 'services' key")
  })

  it('returns base config when no profile is given', () => {
    writeYaml('wiremock.yaml', BASE_YAML)
    const config = readWireMockConfig(tmpDir)
    expect(Object.keys(config.services)).toEqual(['todos-api'])
  })

  it('throws when profile yaml is missing', () => {
    writeYaml('wiremock.yaml', BASE_YAML)
    expect(() => readWireMockConfig(tmpDir, 'development')).toThrow("Environment profile 'development' not found")
  })

  it('merges profile overlay over base config', () => {
    writeYaml('wiremock.yaml', BASE_YAML)
    writeYaml('wiremock-development.yaml', `
services:
  todos-api:
    cloud_id: dev123
`)
    const config = readWireMockConfig(tmpDir, 'development')
    expect(config.services['todos-api'].cloud_id).toBe('dev123')
    // Base fields preserved
    expect(config.services['todos-api'].port).toBe(8080)
    expect(config.services['todos-api'].type).toBe('REST')
  })

  it('profile cannot override type or port', () => {
    writeYaml('wiremock.yaml', BASE_YAML)
    writeYaml('wiremock-staging.yaml', `
services:
  todos-api:
    type: OTHER
    port: 9090
    cloud_id: stg456
`)
    const config = readWireMockConfig(tmpDir, 'staging')
    expect(config.services['todos-api'].type).toBe('REST')
    expect(config.services['todos-api'].port).toBe(8080)
    expect(config.services['todos-api'].cloud_id).toBe('stg456')
  })

  it('profile cannot add new services', () => {
    writeYaml('wiremock.yaml', BASE_YAML)
    writeYaml('wiremock-development.yaml', `
services:
  new-api:
    port: 8081
  todos-api:
    cloud_id: dev789
`)
    const config = readWireMockConfig(tmpDir, 'development')
    expect(Object.keys(config.services)).toEqual(['todos-api'])
  })

  it('handles multiple services', () => {
    writeYaml('wiremock.yaml', `
services:
  api-one:
    type: REST
    port: 8080
  api-two:
    type: REST
    port: 8081
`)
    const config = readWireMockConfig(tmpDir)
    expect(Object.keys(config.services)).toHaveLength(2)
    expect(config.services['api-one'].port).toBe(8080)
    expect(config.services['api-two'].port).toBe(8081)
  })
})
