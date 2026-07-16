import * as exec from '@actions/exec'
import { runUserCommand } from '../../container/exec'

jest.mock('@actions/exec')
jest.mock('@actions/core')

const mockExec = exec.exec as jest.MockedFunction<typeof exec.exec>

beforeEach(() => {
  jest.clearAllMocks()
})

describe('runUserCommand', () => {
  it('runs the command via bash -c with the given env merged over process.env', async () => {
    mockExec.mockResolvedValue(0)
    await runUserCommand({ command: 'echo hi', env: { WIREMOCK_URL: 'http://localhost:8080' } })
    expect(mockExec).toHaveBeenCalledWith('bash', ['-c', 'echo hi'], {
      env: expect.objectContaining({ WIREMOCK_URL: 'http://localhost:8080' }),
    })
  })

  it('throws when the command exits non-zero', async () => {
    mockExec.mockResolvedValue(1)
    await expect(runUserCommand({ command: 'exit 1', env: {} })).rejects.toThrow(
      'Command exited with code 1'
    )
  })
})
