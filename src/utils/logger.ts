import * as core from '@actions/core'

export function notice(message: string): void {
  core.notice(message)
}

export function info(message: string): void {
  core.info(message)
}

export function warning(message: string): void {
  core.warning(message)
}

export function error(message: string): void {
  core.error(message)
}

export function group<T>(name: string, fn: () => Promise<T>): Promise<T> {
  return core.group(name, fn)
}
