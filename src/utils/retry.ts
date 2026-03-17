export interface RetryOptions {
  retries: number
  intervalSeconds: number
  onAttempt?: (attempt: number, total: number) => void
}

export async function retry<T>(
  fn: () => Promise<T>,
  options: RetryOptions
): Promise<T> {
  const { retries, intervalSeconds, onAttempt } = options

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fn()
    } catch (err) {
      if (attempt === retries) throw err
      onAttempt?.(attempt, retries)
      await sleep(intervalSeconds * 1000)
    }
  }

  // unreachable but satisfies TypeScript
  throw new Error('Retry exhausted')
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
