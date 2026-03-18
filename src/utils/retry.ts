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
  const maxAttempts = Math.max(retries, 1)

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn()
    } catch (err) {
      if (attempt === maxAttempts) throw err
      onAttempt?.(attempt, maxAttempts)
      await sleep(intervalSeconds * 1000)
    }
  }

  // unreachable
  throw new Error('Retry exhausted')
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
