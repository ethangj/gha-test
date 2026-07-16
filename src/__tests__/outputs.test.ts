import * as core from '@actions/core'
import { setOutputs } from '../outputs'

jest.mock('@actions/core')

const mockSetOutput = core.setOutput as jest.MockedFunction<typeof core.setOutput>

beforeEach(() => {
  jest.clearAllMocks()
})

describe('setOutputs', () => {
  it('sets mock-api-url when provided', () => {
    setOutputs({ mockApiUrl: 'http://localhost:8080' })
    expect(mockSetOutput).toHaveBeenCalledWith('mock-api-url', 'http://localhost:8080')
  })

  it('sets mock-api-urls as a JSON string when provided', () => {
    setOutputs({ mockApiUrls: { 'todos-api': 'http://localhost:8080' } })
    expect(mockSetOutput).toHaveBeenCalledWith(
      'mock-api-urls',
      JSON.stringify({ 'todos-api': 'http://localhost:8080' })
    )
  })

  it('sets runner-admin-url when provided', () => {
    setOutputs({ runnerAdminUrl: 'http://localhost:9999' })
    expect(mockSetOutput).toHaveBeenCalledWith('runner-admin-url', 'http://localhost:9999')
  })

  it('sets recording-flushed as a stringified boolean when provided', () => {
    setOutputs({ recordingFlushed: true })
    expect(mockSetOutput).toHaveBeenCalledWith('recording-flushed', 'true')
  })

  it('sets nothing when no fields are provided', () => {
    setOutputs({})
    expect(mockSetOutput).not.toHaveBeenCalled()
  })
})
