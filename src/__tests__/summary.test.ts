import * as core from '@actions/core'
import { writeSummary } from '../summary'

jest.mock('@actions/core')

// Build a chainable summary mock
const mockWrite = jest.fn().mockResolvedValue(undefined)
const mockAddRaw = jest.fn()
const mockAddTable = jest.fn()
const mockAddHeading = jest.fn()

const summaryChain = {
  addHeading: mockAddHeading,
  addTable: mockAddTable,
  addRaw: mockAddRaw,
  write: mockWrite,
}

// Each chained call returns the same object
mockAddHeading.mockReturnValue(summaryChain)
mockAddTable.mockReturnValue(summaryChain)
mockAddRaw.mockReturnValue(summaryChain)

beforeEach(() => {
  jest.clearAllMocks()
  mockWrite.mockResolvedValue(undefined)
  mockAddHeading.mockReturnValue(summaryChain)
  mockAddTable.mockReturnValue(summaryChain)
  mockAddRaw.mockReturnValue(summaryChain)
  ;(core as { summary: unknown }).summary = summaryChain
})

describe('writeSummary', () => {
  it('writes heading and table with operation and status', async () => {
    await writeSummary({ operation: 'push', success: true })
    expect(mockAddHeading).toHaveBeenCalledWith('WireMock Runner', 2)
    expect(mockAddTable).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.arrayContaining([
          expect.objectContaining({ data: 'Operation', header: true }),
        ]),
        expect.arrayContaining(['push', expect.stringContaining('Success')]),
      ])
    )
    expect(mockWrite).toHaveBeenCalled()
  })

  it('shows ❌ Failed when success is false', async () => {
    await writeSummary({ operation: 'push', success: false })
    expect(mockAddTable).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.arrayContaining([expect.anything(), expect.stringContaining('Failed')]),
      ])
    )
  })

  it('adds mock API URL table when mockApiUrls is provided', async () => {
    await writeSummary({
      operation: 'serve',
      success: true,
      mockApiUrls: { 'orders-api': 'http://localhost:8080' },
    })
    expect(mockAddHeading).toHaveBeenCalledWith('Mock API URLs', 3)
    expect(mockAddTable).toHaveBeenCalledTimes(2)
  })

  it('skips mock API URL table when mockApiUrls is empty', async () => {
    await writeSummary({ operation: 'serve', success: true, mockApiUrls: {} })
    expect(mockAddTable).toHaveBeenCalledTimes(1)
  })

  it('adds admin URL raw text when adminUrl is provided', async () => {
    await writeSummary({ operation: 'serve', success: true, adminUrl: 'http://localhost:9999' })
    expect(mockAddRaw).toHaveBeenCalledWith(expect.stringContaining('http://localhost:9999'))
  })

  it('adds notes when provided', async () => {
    await writeSummary({ operation: 'push', success: true, notes: 'Some note here' })
    expect(mockAddRaw).toHaveBeenCalledWith(expect.stringContaining('Some note here'))
  })
})
