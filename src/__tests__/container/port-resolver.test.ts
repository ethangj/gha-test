import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { resolveUrls, parsePorts } from '../../container/port-resolver'

// Suppress core.info calls
jest.mock('@actions/core', () => ({
  info: jest.fn(),
}))

let tmpDir: string

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-resolver-'))
})

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

function writeWireMockYaml(services: string) {
  fs.writeFileSync(path.join(tmpDir, 'wiremock.yaml'), `services:\n${services}`, 'utf8')
}

describe('parsePorts', () => {
  it('parses a single port', () => {
    expect(parsePorts('8080')).toEqual([8080])
  })

  it('parses multiple comma-separated ports', () => {
    expect(parsePorts('8080,8081,8082')).toEqual([8080, 8081, 8082])
  })

  it('trims whitespace around ports', () => {
    expect(parsePorts('8080 , 8081')).toEqual([8080, 8081])
  })
})

describe('resolveUrls', () => {
  it('resolves single service URL', () => {
    writeWireMockYaml(`  todos-api:\n    type: REST\n    port: 8080\n`)
    const result = resolveUrls(tmpDir, 'http://localhost:9999')
    expect(result.primary).toBe('http://localhost:8080')
    expect(result.all).toEqual({ 'todos-api': 'http://localhost:8080' })
    expect(result.adminUrl).toBe('http://localhost:9999')
  })

  it('resolves multiple services, primary is first', () => {
    writeWireMockYaml(
      `  api-one:\n    type: REST\n    port: 8080\n  api-two:\n    type: REST\n    port: 8081\n`
    )
    const result = resolveUrls(tmpDir, 'http://localhost:9999')
    expect(result.primary).toBe('http://localhost:8080')
    expect(result.all['api-one']).toBe('http://localhost:8080')
    expect(result.all['api-two']).toBe('http://localhost:8081')
    expect(result.services).toHaveLength(2)
  })

  it('throws when no services are defined', () => {
    fs.writeFileSync(path.join(tmpDir, 'wiremock.yaml'), 'services: {}\n', 'utf8')
    expect(() => resolveUrls(tmpDir, 'http://localhost:9999')).toThrow('defines no services')
  })

  it('passes profile to yaml reader', () => {
    writeWireMockYaml(`  todos-api:\n    type: REST\n    port: 8080\n    cloud_id: base\n`)
    fs.writeFileSync(
      path.join(tmpDir, 'wiremock-development.yaml'),
      'services:\n  todos-api:\n    cloud_id: dev\n',
      'utf8'
    )
    const result = resolveUrls(tmpDir, 'http://localhost:9999', 'development')
    // URL should still resolve based on port (port is not overridable)
    expect(result.primary).toBe('http://localhost:8080')
  })

  it('services array reflects all resolved services', () => {
    writeWireMockYaml(`  svc-a:\n    type: REST\n    port: 8080\n`)
    const result = resolveUrls(tmpDir, 'http://localhost:9999')
    expect(result.services[0]).toEqual({ name: 'svc-a', url: 'http://localhost:8080', port: 8080 })
  })
})
