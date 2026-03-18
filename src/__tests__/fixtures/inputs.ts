import type { Inputs } from '../../inputs'

export function makeInputs(overrides: Partial<Inputs> = {}): Inputs {
  return {
    'api-token': 'test-token',
    'wiremock-dir': '.wiremock',
    'runner-admin-url': 'http://localhost:9999',
    'runner-admin-port': 9999,
    'runner-version': 'latest',
    mode: 'serve',
    ports: '8080',
    'post-run-pull': false,
    all: false,
    force: false,
    'wiremock-cli-version': 'latest',
    'health-check-retries': 30,
    'health-check-interval': 2,
    ...overrides,
  } as Inputs
}
