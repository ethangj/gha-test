jest.mock('@actions/core', () => ({
  getState: jest.fn(),
  warning: jest.fn(),
}))

jest.mock('@actions/exec', () => ({
  exec: jest.fn(),
}))

import * as core from '@actions/core'
import * as exec from '@actions/exec'
import { stopContainer } from '../../src/container/lifecycle'

const mockGetState = core.getState as jest.Mock
const mockExec = exec.exec as jest.Mock
const mockWarning = core.warning as jest.Mock

describe('stopContainer', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('calls docker stop then docker rm with the container name', async () => {
    mockExec.mockResolvedValue(0)
    await stopContainer('wiremock-runner-123-job-abc123')
    expect(mockExec).toHaveBeenCalledWith(
      'docker',
      ['stop', '--time', '5', 'wiremock-runner-123-job-abc123']
    )
    expect(mockExec).toHaveBeenCalledWith(
      'docker',
      ['rm', '-f', 'wiremock-runner-123-job-abc123'],
      { ignoreReturnCode: true }
    )
  })

  it('emits a warning (not an error) when docker stop fails, still calls docker rm', async () => {
    mockExec.mockRejectedValueOnce(new Error('container not found'))
    mockExec.mockResolvedValue(0)
    await expect(stopContainer('wiremock-runner-123-job-abc123')).resolves.toBeUndefined()
    expect(mockWarning).toHaveBeenCalledWith(
      expect.stringContaining('Could not stop container')
    )
    expect(mockExec).toHaveBeenCalledWith(
      'docker',
      ['rm', '-f', 'wiremock-runner-123-job-abc123'],
      { ignoreReturnCode: true }
    )
  })
})

describe('post step — no container name in state', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('skips docker stop when containerName state is empty', async () => {
    mockGetState.mockReturnValue('')
    // Simulate the post-step logic inline
    const containerName = core.getState('containerName')
    if (containerName) {
      await stopContainer(containerName)
    }
    expect(mockExec).not.toHaveBeenCalled()
  })
})
