import * as core from '@actions/core'

export interface SummaryData {
  operation: string
  success: boolean
  mockApiUrls?: Record<string, string>
  adminUrl?: string
  notes?: string
}

export async function writeSummary(data: SummaryData): Promise<void> {
  const { operation, success, mockApiUrls, adminUrl, notes } = data
  const status = success ? '✅ Success' : '❌ Failed'

  const summary = core.summary
    .addHeading('WireMock Runner', 2)
    .addTable([
      [
        { data: 'Operation', header: true },
        { data: 'Result', header: true },
      ],
      [operation, status],
    ])

  if (mockApiUrls && Object.keys(mockApiUrls).length > 0) {
    summary.addHeading('Mock API URLs', 3)
    summary.addTable([
      [
        { data: 'Service', header: true },
        { data: 'URL', header: true },
      ],
      ...Object.entries(mockApiUrls).map(([name, url]) => [name, url]),
    ])
  }

  if (adminUrl) {
    summary.addRaw(`\n**Runner Admin URL:** \`${adminUrl}\`\n`)
  }

  if (notes) {
    summary.addRaw(`\n${notes}\n`)
  }

  await summary.write()
}
