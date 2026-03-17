import * as core from '@actions/core'

export interface ActionOutputs {
  mockApiUrl?: string
  mockApiUrls?: Record<string, string>
  runnerAdminUrl?: string
  recordingFlushed?: boolean
}

export function setOutputs(outputs: ActionOutputs): void {
  if (outputs.mockApiUrl !== undefined) {
    core.setOutput('mock-api-url', outputs.mockApiUrl)
  }
  if (outputs.mockApiUrls !== undefined) {
    core.setOutput('mock-api-urls', JSON.stringify(outputs.mockApiUrls))
  }
  if (outputs.runnerAdminUrl !== undefined) {
    core.setOutput('runner-admin-url', outputs.runnerAdminUrl)
  }
  if (outputs.recordingFlushed !== undefined) {
    core.setOutput('recording-flushed', String(outputs.recordingFlushed))
  }
}
