import { retry } from '../../utils/retry'

describe('retry', () => {
  it('returns result on first success', async () => {
    const fn = jest.fn().mockResolvedValue('ok')
    const result = await retry(fn, { retries: 3, intervalSeconds: 0 })
    expect(result).toBe('ok')
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('retries and succeeds on third attempt', async () => {
    const fn = jest
      .fn()
      .mockRejectedValueOnce(new Error('fail 1'))
      .mockRejectedValueOnce(new Error('fail 2'))
      .mockResolvedValue('ok')
    const result = await retry(fn, { retries: 3, intervalSeconds: 0 })
    expect(result).toBe('ok')
    expect(fn).toHaveBeenCalledTimes(3)
  })

  it('throws after exhausting all retries', async () => {
    const fn = jest.fn().mockRejectedValue(new Error('always fails'))
    await expect(retry(fn, { retries: 3, intervalSeconds: 0 })).rejects.toThrow('always fails')
    expect(fn).toHaveBeenCalledTimes(3)
  })

  it('calls onAttempt callback on each failed attempt except the last', async () => {
    const onAttempt = jest.fn()
    const fn = jest
      .fn()
      .mockRejectedValueOnce(new Error('fail'))
      .mockRejectedValueOnce(new Error('fail'))
      .mockResolvedValue('done')
    await retry(fn, { retries: 3, intervalSeconds: 0, onAttempt })
    expect(onAttempt).toHaveBeenCalledTimes(2)
    expect(onAttempt).toHaveBeenCalledWith(1, 3)
    expect(onAttempt).toHaveBeenCalledWith(2, 3)
  })

  it('does not call onAttempt when succeeding immediately', async () => {
    const onAttempt = jest.fn()
    await retry(jest.fn().mockResolvedValue('ok'), { retries: 3, intervalSeconds: 0, onAttempt })
    expect(onAttempt).not.toHaveBeenCalled()
  })

  it('retries exactly once with retries: 1', async () => {
    const fn = jest.fn().mockRejectedValue(new Error('fail'))
    await expect(retry(fn, { retries: 1, intervalSeconds: 0 })).rejects.toThrow('fail')
    expect(fn).toHaveBeenCalledTimes(1)
  })
})
