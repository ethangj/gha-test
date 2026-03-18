/**
 * Tests for input validation via getInputs().
 * We mock @actions/core.getInput to inject values.
 */

jest.mock('@actions/core')
import * as core from '@actions/core'

const mockGetInput = core.getInput as jest.MockedFunction<typeof core.getInput>
const mockSetFailed = core.setFailed as jest.MockedFunction<typeof core.setFailed>

import { getInputs } from '../inputs'
import { ActionFatalError } from '../errors'

function setInputs(inputs: Record<string, string>) {
  mockGetInput.mockImplementation((name: string) => inputs[name] ?? '')
}

beforeEach(() => {
  jest.clearAllMocks()
})

describe('getInputs', () => {
  describe('valid inputs', () => {
    it('accepts run with mode=serve', () => {
      setInputs({ run: 'npm test', 'api-token': 'tok' })
      const inputs = getInputs()
      expect(inputs.run).toBe('npm test')
      expect(inputs.mode).toBe('serve')
    })

    it('accepts run with mode=record-many', () => {
      setInputs({ run: 'bash script.sh', mode: 'record-many', 'api-token': 'tok' })
      const inputs = getInputs()
      expect(inputs.mode).toBe('record-many')
    })

    it('accepts command=push with api-token', () => {
      setInputs({ command: 'push', 'api-token': 'tok' })
      const inputs = getInputs()
      expect(inputs.command).toBe('push')
    })

    it('accepts command=mode-switch with target-mode', () => {
      setInputs({ command: 'mode-switch', 'target-mode': 'record-many' })
      const inputs = getInputs()
      expect(inputs['target-mode']).toBe('record-many')
    })

    it('accepts command=resolve-urls with no api-token', () => {
      setInputs({ command: 'resolve-urls' })
      const inputs = getInputs()
      expect(inputs.command).toBe('resolve-urls')
    })

    it('applies defaults', () => {
      setInputs({ run: 'echo hi' })
      const inputs = getInputs()
      expect(inputs['wiremock-dir']).toBe('.wiremock')
      expect(inputs.mode).toBe('serve')
      expect(inputs.ports).toBe('8080')
      expect(inputs['runner-admin-port']).toBe(9999)
      expect(inputs['runner-version']).toBe('latest')
      expect(inputs['post-run-pull']).toBe(false)
      expect(inputs.all).toBe(false)
      expect(inputs.force).toBe(false)
      expect(inputs['health-check-retries']).toBe(30)
      expect(inputs['health-check-interval']).toBe(2)
    })

    it('transforms post-run-pull string to boolean', () => {
      setInputs({ run: 'echo hi', 'api-token': 'tok', 'post-run-pull': 'true', mode: 'record-many' })
      const inputs = getInputs()
      expect(inputs['post-run-pull']).toBe(true)
    })

    it('accepts multiple ports', () => {
      setInputs({ run: 'echo hi', ports: '8080,8081' })
      const inputs = getInputs()
      expect(inputs.ports).toBe('8080,8081')
    })

    it('accepts custom wiremock-dir', () => {
      setInputs({ run: 'echo hi', 'wiremock-dir': 'mocks' })
      const inputs = getInputs()
      expect(inputs['wiremock-dir']).toBe('mocks')
    })
  })

  describe('validation failures', () => {
    it('fails when neither run nor command is set', () => {
      setInputs({})
      expect(() => getInputs()).toThrow(ActionFatalError)
      expect(mockSetFailed).toHaveBeenCalledWith(
        expect.stringContaining('run')
      )
    })

    it('fails when both run and command are set', () => {
      setInputs({ run: 'npm test', command: 'push', 'api-token': 'tok' })
      expect(() => getInputs()).toThrow(ActionFatalError)
      expect(mockSetFailed).toHaveBeenCalledWith(
        expect.stringContaining('mutually exclusive')
      )
    })

    it('fails when command=push is used without api-token', () => {
      setInputs({ command: 'push' })
      expect(() => getInputs()).toThrow(ActionFatalError)
      expect(mockSetFailed).toHaveBeenCalledWith(
        expect.stringContaining('api-token')
      )
    })

    it('fails when command=pull is used without api-token', () => {
      setInputs({ command: 'pull' })
      expect(() => getInputs()).toThrow(ActionFatalError)
      expect(mockSetFailed).toHaveBeenCalledWith(expect.stringContaining('api-token'))
    })

    it('fails when command=environments-create is used without api-token', () => {
      setInputs({ command: 'environments-create' })
      expect(() => getInputs()).toThrow(ActionFatalError)
    })

    it('fails when command=mode-switch has no target-mode', () => {
      setInputs({ command: 'mode-switch' })
      expect(() => getInputs()).toThrow(ActionFatalError)
      expect(mockSetFailed).toHaveBeenCalledWith(
        expect.stringContaining('target-mode')
      )
    })

    it('fails when post-run-pull=true but no api-token', () => {
      setInputs({ run: 'echo hi', 'post-run-pull': 'true', mode: 'record-many' })
      expect(() => getInputs()).toThrow(ActionFatalError)
      expect(mockSetFailed).toHaveBeenCalledWith(
        expect.stringContaining('api-token')
      )
    })

    it('fails on invalid port value', () => {
      setInputs({ run: 'echo hi', ports: 'abc' })
      expect(() => getInputs()).toThrow(ActionFatalError)
      expect(mockSetFailed).toHaveBeenCalledWith(
        expect.stringContaining('Invalid port')
      )
    })

    it('fails when port conflicts with runner-admin-port', () => {
      setInputs({ run: 'echo hi', ports: '9999', 'runner-admin-port': '9999' })
      expect(() => getInputs()).toThrow(ActionFatalError)
      expect(mockSetFailed).toHaveBeenCalledWith(
        expect.stringContaining('conflicts')
      )
    })

    it('fails when port is out of range', () => {
      setInputs({ run: 'echo hi', ports: '99999' })
      expect(() => getInputs()).toThrow(ActionFatalError)
    })

    it('fails when runner-version contains a registry prefix', () => {
      setInputs({ run: 'echo hi', 'runner-version': 'attacker.io/malicious:latest' })
      expect(() => getInputs()).toThrow(ActionFatalError)
    })

    it('fails when wiremock-cli-version contains a file: prefix', () => {
      setInputs({ run: 'echo hi', 'wiremock-cli-version': 'file:../malicious' })
      expect(() => getInputs()).toThrow(ActionFatalError)
    })

    it('accepts runner-version as semver', () => {
      setInputs({ run: 'echo hi', 'runner-version': '1.2.3' })
      const inputs = getInputs()
      expect(inputs['runner-version']).toBe('1.2.3')
    })

    it('accepts runner-version as semver with pre-release', () => {
      setInputs({ run: 'echo hi', 'runner-version': '1.2.3-beta.1' })
      const inputs = getInputs()
      expect(inputs['runner-version']).toBe('1.2.3-beta.1')
    })

    it('fails when mock-api contains flag injection characters', () => {
      setInputs({ command: 'push', 'api-token': 'tok', 'mock-api': '--token override' })
      expect(() => getInputs()).toThrow(ActionFatalError)
    })

    it('fails when profile contains path traversal characters', () => {
      setInputs({ run: 'echo hi', profile: '../../../etc' })
      expect(() => getInputs()).toThrow(ActionFatalError)
    })

    it('accepts valid mock-api and profile names', () => {
      setInputs({ command: 'push', 'api-token': 'tok', 'mock-api': 'orders-api', profile: 'my-profile-1' })
      const inputs = getInputs()
      expect(inputs['mock-api']).toBe('orders-api')
      expect(inputs.profile).toBe('my-profile-1')
    })

    it('fails when runner-admin-url targets cloud metadata endpoint', () => {
      setInputs({ run: 'echo hi', 'runner-admin-url': 'http://169.254.169.254/' })
      expect(() => getInputs()).toThrow(ActionFatalError)
    })

    it('accepts runner-admin-url targeting localhost', () => {
      setInputs({ run: 'echo hi', 'runner-admin-url': 'http://localhost:9999' })
      const inputs = getInputs()
      expect(inputs['runner-admin-url']).toBe('http://localhost:9999')
    })

    it('accepts runner-admin-url targeting Docker Compose service hostname', () => {
      setInputs({ run: 'echo hi', 'runner-admin-url': 'http://wiremock-runner:9999' })
      const inputs = getInputs()
      expect(inputs['runner-admin-url']).toBe('http://wiremock-runner:9999')
    })

    it('fails when runner-admin-url targets a public IP', () => {
      setInputs({ run: 'echo hi', 'runner-admin-url': 'http://8.8.8.8:9999' })
      expect(() => getInputs()).toThrow(ActionFatalError)
    })
  })
})
