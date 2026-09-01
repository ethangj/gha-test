# WireMock Runner GitHub Action — Master Build Plan

> **Purpose:** Complete specification for Claude Code to implement the
> `wiremock/wiremock-runner-action` GitHub Action. This document covers
> repository structure, all input/output contracts, both runtime patterns
> (ephemeral step and sidecar service), every documented use case from the
> WireMock docs, environment variable mapping, failure handling, testing
> strategy, and Marketplace publication requirements.
>
> **Note:** All workflow examples use SHA-pinned action references per 2026
> security best practices. Dependabot keeps SHAs current automatically.

---

## 1. Repository Structure

```
wiremock-runner-action/
├── action.yml                  # Action metadata — the marketplace contract
├── README.md                   # Marketplace listing content + usage examples
├── LICENSE                     # Apache 2.0
├── CHANGELOG.md
│
├── .github/
│   ├── dependabot.yml          # Auto-update actions and npm deps
│   └── workflows/
│       ├── ci.yml              # PR checks: lint + unit tests (no secrets needed)
│       ├── integration.yml     # Integration tests (environment-gated, needs secrets)
│       └── release.yml         # Build verify, tag, and publish
│
├── .nvmrc                      # 24
├── package.json
├── package-lock.json
├── tsconfig.json
├── tsup.config.ts              # Bundler config (replaces scripts/build.sh)
├── jest.config.ts
├── .eslintrc.json
│   # .gitignore must NOT exclude dist/ — it must be committed for Actions to work
│
├── src/
│   ├── main.ts                 # Entry point — dispatches to correct handler
│   ├── inputs.ts               # Zod schema, input parsing, validation, defaults
│   ├── outputs.ts              # Writing to GITHUB_OUTPUT via core.setOutput()
│   ├── summary.ts              # Step summary builder via core.summary
│   ├── cli/
│   │   ├── installer.ts        # npm install -g @wiremock/cli
│   │   ├── push-pull.ts        # push / pull / environments-create
│   │   └── record-flush.ts     # record-flush, record-stop, mode-switch
│   ├── container/
│   │   ├── lifecycle.ts        # docker run / stop / health-check
│   │   ├── port-resolver.ts    # parse wiremock.yaml → URL map
│   │   └── exec.ts             # spawn user's `run:` command with env injection
│   └── utils/
│       ├── logger.ts           # ::notice / ::warning / ::error wrappers
│       ├── retry.ts            # exponential backoff for health checks
│       └── yaml-reader.ts      # parse .wiremock/wiremock.yaml
│
├── dist/
│   └── index.js                # Compiled + bundled with tsup — MUST be committed
│
└── tests/
    ├── unit/
    │   ├── inputs.test.ts
    │   ├── port-resolver.test.ts
    │   ├── yaml-reader.test.ts
    │   └── post-step.test.ts
    └── integration/
        ├── push-pull.test.ts
        ├── ephemeral-serve.test.ts
        └── ephemeral-record.test.ts
```

**Runtime:** JavaScript (TypeScript, compiled to single `dist/index.js` via
`tsup`). This is the correct choice for a GitHub-hosted Action because:
- No Docker pull overhead on every run
- Works on `ubuntu-latest`, `macos-latest`, `windows-latest`
- Fast cold start
- The Docker container (wiremock-runner) is only started when `run:` input is
  present — the Action itself is pure JS

**Key project files:**

`package.json` must declare at minimum:
```json
{
  "name": "wiremock-runner-action",
  "version": "1.0.0",
  "engines": { "node": ">=24" },
  "scripts": {
    "build":  "tsup",
    "test":   "jest",
    "lint":   "eslint src tests --ext .ts"
  },
  "dependencies": {
    "@actions/core":        "^1.11.1",
    "@actions/exec":        "^1.1.1",
    "@actions/http-client": "^2.2.3",
    "@actions/io":          "^1.1.3",
    "@actions/tool-cache":  "^2.0.2",
    "js-yaml":              "^4.1.0",
    "zod":                  "^4.0.0"
  },
  "devDependencies": {
    "@types/js-yaml":        "^4.0.9",
    "@types/node":           "^22.0.0",
    "@typescript-eslint/eslint-plugin": "^8.0.0",
    "@typescript-eslint/parser":        "^8.0.0",
    "eslint":                "^9.0.0",
    "jest":                  "^29.0.0",
    "ts-jest":               "^29.0.0",
    "tsup":                  "^9.0.0",
    "typescript":            "^5.5.0"
  }
}
```

`tsup.config.ts`:
```ts
import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/main.ts'],
  format: ['cjs'],
  bundle: true,
  minify: true,
  sourcemap: true,
  outDir: 'dist',
  outExtension: () => ({ js: '.js' }),
  noExternal: [/.*/],   // bundle everything — required for GitHub Actions
})
```

`.nvmrc`:
```
24
```

`.gitignore` — critical note: `dist/` must **not** be ignored. GitHub Actions
users reference the repo directly and the runner serves `dist/index.js` from
the repository tree. Only exclude:
```
node_modules/
*.js.map  # optional — include for debugging; exclude to keep repo clean
```

---

## 2. `action.yml` — Complete Specification

```yaml
name: 'WireMock Runner'
description: >
  Push/pull mock API specs, run mock servers, and record API traffic
  using WireMock Cloud and WireMock Runner.
author: 'WireMock'

branding:
  icon: 'zap'
  color: 'orange'

# ─────────────────────────────────────────────
# INPUTS
# ─────────────────────────────────────────────
inputs:

  # ── Shared ──────────────────────────────────
  api-token:
    description: >
      WireMock Cloud API token. Required for all push/pull/environments
      operations and for ephemeral container mode when the Runner needs
      to sync with WireMock Cloud.
    required: false

  wiremock-dir:
    description: >
      Path to the directory containing wiremock.yaml (and profile files).
      Defaults to .wiremock in the workspace root.
    required: false
    default: '.wiremock'

  # ── Pattern 1: Ephemeral container mode ─────
  # Triggered by presence of `run` input.
  run:
    description: >
      Shell command to execute while the Runner container is live.
      When set, the Action starts a wiremock/wiremock-runner container,
      waits for it to be healthy, executes this command, then stops the
      container. Supports serve mode (for tests) and record-many mode
      (for recording).
    required: false

  mode:
    description: >
      Runner mode for the ephemeral container. One of: serve, record-many.
      Default: serve.
    required: false
    default: 'serve'

  ports:
    description: >
      Comma-separated list of mock API ports to expose from the container.
      Must match the port values in wiremock.yaml.
      Example: '8080,8081'
    required: false
    default: '8080'

  runner-admin-port:
    description: >
      Port for the Runner admin HTTP interface. Default: 9999.
    required: false
    default: '9999'

  runner-version:
    description: >
      Docker image tag for wiremock/wiremock-runner. Default: latest.
      Pin to a specific version for reproducible builds.
    required: false
    default: 'latest'

  profile:
    description: >
      Environment profile name. Activates wiremock-<profile>.yaml overlay.
      Used in both ephemeral container mode and CLI command mode.
      Example: staging, development
    required: false

  post-run-pull:
    description: >
      When 'true' and mode is record-many, automatically pull recorded
      stubs from WireMock Cloud into the workspace after recording stops.
      Requires api-token to be set.
    required: false
    default: 'false'

  # ── Pattern 2: CLI command mode ─────────────
  # Triggered by presence of `command` input.
  command:
    description: >
      CLI operation to perform. One of:
        push                  — push local stubs to WireMock Cloud
        pull                  — pull stubs from WireMock Cloud
        environments-create   — create a new environment/profile in Cloud
        record-flush          — flush buffered recordings to Cloud
        record-stop           — switch Runner from record-many to serve
        record-flush-and-stop — flush then switch to serve (recommended)
        mode-switch           — switch Runner to any mode
        resolve-urls          — parse wiremock.yaml and emit service URLs
                                as step outputs (does not require a running
                                Runner; set runner-admin-url to also verify
                                the Runner is healthy)
    required: false

  mock-api:
    description: >
      Name of the mock API as defined in wiremock.yaml. Used with
      push, pull, and environments-create commands.
      When all: 'true' is set, this field is optional and acts as a
      validation hint only; all APIs in wiremock.yaml are processed.
    required: false

  all:
    description: >
      When 'true', passes --all to push/pull (processes all APIs in
      wiremock.yaml rather than a single named one).
    required: false
    default: 'false'

  runner-admin-url:
    description: >
      Base URL of a running Runner's admin API. Required for
      record-flush, record-stop, record-flush-and-stop, mode-switch,
      and resolve-urls (when health verification is desired).
      Default: http://localhost:9999
    required: false
    default: 'http://localhost:9999'

  include-services:
    description: >
      Comma-separated list of service keys to record (maps to
      --include-services). When omitted, all services are recorded.
      Example: invoicing-api,payment-api
    required: false

  target-mode:
    description: >
      Target mode for the mode-switch command. One of: serve, record-many.
    required: false

  runner-config:
    description: >
      YAML string of additional configuration fields to pass to the
      Runner's mode-switch endpoint as the `config` object. Allows
      pass-through of any Runner config options (e.g. batching settings)
      without requiring Action updates.
      Example:
        runner-config: |
          max-batch-requests: 50
          max-batch-bytes: 10MB
    required: false

  force:
    description: >
      When 'true' and command is environments-create, overrides the
      default idempotency guard. The CLI does not support overwriting an
      existing environment profile — if the profile file already exists,
      this flag causes the Action to fail with a clear error rather than
      silently skipping. Use to detect accidental re-runs.
    required: false
    default: 'false'

  wiremock-cli-version:
    description: >
      npm version tag for @wiremock/cli. Default: latest.
      Pin to a specific version for reproducible builds.
    required: false
    default: 'latest'

  health-check-retries:
    description: >
      Number of times to poll /__/health before failing. Default: 30.
    required: false
    default: '30'

  health-check-interval:
    description: >
      Seconds between health check polls. Default: 2.
    required: false
    default: '2'

# ─────────────────────────────────────────────
# OUTPUTS
# ─────────────────────────────────────────────
# NOTE: This is a JavaScript action (runs: node24). Output values are set
# at runtime via core.setOutput() in the TypeScript code. The `value:` field
# is only valid for composite actions and MUST NOT appear here.
outputs:

  mock-api-url:
    description: >
      Base URL of the primary mock API (first service in wiremock.yaml).
      Available in both ephemeral and sidecar patterns.

  mock-api-urls:
    description: >
      JSON object mapping service name to base URL for all running services.
      Example: {"invoicing-api":"http://localhost:8080","payment-api":"http://localhost:8081"}

  runner-admin-url:
    description: >
      URL of the Runner admin interface (confirmed live when health check ran).

  recording-flushed:
    description: >
      'true' if recordings were successfully flushed to WireMock Cloud.

# ─────────────────────────────────────────────
# RUNTIME
# ─────────────────────────────────────────────
runs:
  using: 'node24'
  main: 'dist/index.js'
  post: 'dist/index.js'       # post step handles container teardown
  post-if: always()           # must be always() — success()||failure() skips cancellation
```

---

## 3. Environment Variable Mapping

### 3a. WireMock Runner container env vars

When the Action starts an ephemeral container, it sets:

| Container env var         | Source                                  | Notes                                      |
|---------------------------|-----------------------------------------|--------------------------------------------|
| `WMC_DEFAULT_MODE`        | `inputs.mode`                           | `serve` or `record-many`                   |
| `WMC_ADMIN_PORT`          | `inputs.runner-admin-port`              | Default 9999                               |
| `WMC_API_TOKEN`           | `inputs.api-token`                      | Must be masked in logs via core.setSecret()|
| `WMC_RUN_PROFILE`         | `inputs.profile` (serve mode only)      | Activates profile overlay for serve        |
| `WMC_RECORD_MANY_PROFILE` | `inputs.profile` (record-many mode only)| Activates profile overlay for recording    |

The profile env var is mode-conditional: if `mode == 'serve'` set `WMC_RUN_PROFILE`;
if `mode == 'record-many'` set `WMC_RECORD_MANY_PROFILE`. Never set both.

### 3b. Env vars injected into the user's `run:` command

When the Action executes the user-supplied `run:` command, these are set in the subprocess environment so test scripts can reference them without hardcoding ports:

| Env var                  | Value                                                                 |
|--------------------------|-----------------------------------------------------------------------|
| `WIREMOCK_URL`           | URL of first service (e.g. `http://localhost:8080`)                  |
| `WIREMOCK_ADMIN_URL`     | Runner admin URL (e.g. `http://localhost:9999`)                      |
| `WIREMOCK_URLS`          | JSON map of all services (same as `mock-api-urls` output)            |
| `WIREMOCK_MODE`          | `serve` or `record-many`                                             |
| `WIREMOCK_PROFILE`       | Profile name if set, else empty string                               |

### 3c. GitHub Actions secrets guidance (README)

Users must create these GitHub secrets before using the Action:

| Secret                  | Where to get it                                          |
|-------------------------|----------------------------------------------------------|
| `WIREMOCK_API_TOKEN`    | app.wiremock.cloud → Account → Security → API tokens    |

The Action never logs the token value. It is passed to the container via env
var and to the CLI via `wiremock config set api_token` which writes to a
config file, not stdout.

### 3d. GitHub Actions vars (non-secret, optional)

| Variable                     | Purpose                                                  |
|------------------------------|----------------------------------------------------------|
| `WIREMOCK_RUNNER_ADMIN_URL`  | Override default runner admin URL for self-hosted setups |
| `WIREMOCK_CLI_VERSION`       | Org-wide pin for CLI version                             |

---

## 4. Use Cases — Complete Mapping from Documentation

### UC-1: Deploy mock specs to staging on merge to main

**Source:** docs.wiremock.io/runner/promoting-apis-with-git-and-ci

**Trigger:** Push to `main` branch, `.wiremock/**` paths changed

```yaml
# .github/workflows/deploy-staging.yml
name: Deploy to Staging
on:
  push:
    branches: [main]
    paths: ['.wiremock/**']

permissions: {}

jobs:
  deploy:
    runs-on: ubuntu-latest
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683  # v4.2.2

      - name: Push mock APIs to staging
        uses: wiremock/wiremock-runner-action@v1
        with:
          api-token: ${{ secrets.WIREMOCK_API_TOKEN }}
          command: push
          mock-api: mock-api
          all: 'true'
          profile: staging
```

**What the Action does internally:**
1. Masks the token: `core.setSecret(inputs.apiToken)` — first operation before any logging
2. Installs `@wiremock/cli@<version>`
3. Runs `wiremock config set api_token <token>`
4. Runs `wiremock push mock-api --all --profile staging`
   - When `all: 'true'`, `mock-api` is passed for validation/hint but `--all` flag governs what is processed
5. Emits `::notice` with number of stubs pushed
6. Writes step summary via `core.summary`

---

### UC-2: Pull updated stubs from development into the repo

**Source:** docs.wiremock.io/runner/promoting-apis-with-git-and-ci — "Pull your changes"

```yaml
- name: Pull from development
  uses: wiremock/wiremock-runner-action@v1
  with:
    api-token: ${{ secrets.WIREMOCK_API_TOKEN }}
    command: pull
    mock-api: mock-api
    all: 'true'
    profile: development

- name: Commit updated stubs
  uses: stefanzweifel/git-auto-commit-action@8621f86c01e598b68f4e7e9c3b14e82bf1e6a0f2  # v5
  with:
    commit_message: 'chore: update recorded stub mappings from development'
    file_pattern: '.wiremock/**'
```

---

### UC-3: Bootstrap a new environment (first-time setup)

**Source:** docs.wiremock.io/cli/environments — "Creating an Environment"

**Note:** `environments create` checks whether the profile file already exists
and will error if it does. The Action wraps this with an idempotency guard:
it checks for the profile file first and skips creation if it exists (unless
`force: 'true'` is passed — see F-9 for that behavior).

```yaml
- name: Create staging environment
  uses: wiremock/wiremock-runner-action@v1
  with:
    api-token: ${{ secrets.WIREMOCK_API_TOKEN }}
    command: environments-create
    profile: staging
```

**What the Action does internally:**
1. Checks whether `.wiremock/wiremock-staging.yaml` exists
2. If it does, emits `::notice` "Environment 'staging' already exists, skipping"
3. If not, runs `wiremock environments create --profile staging`

---

### UC-4: Run tests against mocked APIs (ephemeral serve)

**Source:** docs.wiremock.io/runner/overview, local-playback

**Pattern:** Ephemeral step — Action manages full container lifecycle

```yaml
- name: Test against mock APIs
  id: mocks
  uses: wiremock/wiremock-runner-action@v1
  with:
    api-token: ${{ secrets.WIREMOCK_API_TOKEN }}
    mode: serve
    profile: staging
    ports: '8080,8081'
    run: npm test

- name: Report mock URLs used
  run: echo "Tests ran against ${{ steps.mocks.outputs.mock-api-urls }}"
```

**What the Action does internally (in order):**
1. Validates Docker is available; fails with clear error if not
2. Parses `<wiremock-dir>/wiremock.yaml` (using value of `wiremock-dir` input, default `.wiremock`) to build port list and service map
3. Runs:
   ```
   docker run -d \
     --name wiremock-runner-${{ github.run_id }}-${{ github.job }} \
     -e WMC_DEFAULT_MODE=serve \
     -e WMC_ADMIN_PORT=9999 \
     -e WMC_API_TOKEN=<token> \
     -e WMC_RUN_PROFILE=staging \
     -v $GITHUB_WORKSPACE/<wiremock-dir>:/work/.wiremock \
     -p 9999:9999 -p 8080:8080 -p 8081:8081 \
     wiremock/wiremock-runner:<version>
   ```
   Note: `<wiremock-dir>` is the resolved value of the `wiremock-dir` input,
   not hardcoded `.wiremock`. The container always mounts to `/work/.wiremock`.
4. Polls `http://localhost:9999/__/health` with retry (default 30×, 2s)
5. Resolves service URLs from wiremock.yaml port map
6. Writes URL outputs via `core.setOutput()`
7. Injects `WIREMOCK_URL`, `WIREMOCK_URLS` etc. into subprocess env
8. Executes `npm test` as subprocess; streams stdout/stderr to Actions log
9. Captures exit code
10. **Always** (via post step, `post-if: always()`): runs `docker stop wiremock-runner-...`
11. Exits with the user command's exit code

---

### UC-5: Record API traffic in CI (ephemeral record-many)

**Source:** docs.wiremock.io/runner/record-many, cli/multi-domain-recording,
cli/non-interactive-recording

**Pattern:** Ephemeral step with `mode: record-many`

```yaml
- name: Record API interactions
  id: recording
  uses: wiremock/wiremock-runner-action@v1
  with:
    api-token: ${{ secrets.WIREMOCK_API_TOKEN }}
    mode: record-many
    profile: development
    ports: '8080,8081'
    post-run-pull: 'true'           # auto-pull stubs after recording stops
    run: ./scripts/record-journey.sh

- name: Commit recorded stubs
  uses: stefanzweifel/git-auto-commit-action@8621f86c01e598b68f4e7e9c3b14e82bf1e6a0f2  # v5
  with:
    commit_message: 'chore: update recorded stubs'
    file_pattern: '.wiremock/**'
```

**What the Action does internally (in addition to UC-4 steps):**
1. Starts container with `WMC_DEFAULT_MODE=record-many`
2. Executes user's script (traffic is proxied and recorded)
3. Before stopping: `POST http://localhost:9999/v1/record-many/flush`
4. Emits `recording-flushed: true` output via `core.setOutput()`
5. If `post-run-pull: true`: runs `wiremock pull mock-api --all --profile development`
6. Stops container

**Non-interactive mode note:** The Runner auto-detects non-TTY environments
(CI) and uses `request-log-level: off`. No special flag needed.

---

### UC-6: Record multi-service APIs (include-services filter)

**Source:** docs.wiremock.io/cli/multi-domain-recording — "Choosing which services"

**Pattern:** Sidecar service + CLI steps

```yaml
jobs:
  record:
    runs-on: ubuntu-latest
    permissions:
      contents: write
    services:
      wiremock-runner:
        image: wiremock/wiremock-runner:latest
        env:
          WMC_DEFAULT_MODE: record-many
          WMC_ADMIN_PORT: 9999
          WMC_API_TOKEN: ${{ secrets.WIREMOCK_API_TOKEN }}
          WMC_RECORD_MANY_PROFILE: development
        ports: ['9999:9999', '8080:8080', '8081:8081']
        options: >-
          --health-cmd "curl -sf http://localhost:9999/__/health"
          --health-interval 5s
          --health-retries 12

    steps:
      - uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683  # v4.2.2

      # Restrict recording to specific services
      - name: Configure recording scope
        uses: wiremock/wiremock-runner-action@v1
        with:
          command: mode-switch
          target-mode: record-many
          include-services: 'invoicing-api,payment-api'
          runner-admin-url: http://localhost:9999

      - name: Run integration tests
        run: ./run-integration-tests.sh
        env:
          INVOICING_URL: http://localhost:8080
          PAYMENT_URL: http://localhost:8081

      - name: Flush and stop recording
        uses: wiremock/wiremock-runner-action@v1
        with:
          command: record-flush-and-stop
          runner-admin-url: http://localhost:9999

      - name: Pull recorded stubs
        uses: wiremock/wiremock-runner-action@v1
        with:
          api-token: ${{ secrets.WIREMOCK_API_TOKEN }}
          command: pull
          mock-api: mock-api
          all: 'true'
          profile: development
```

**What `mode-switch` with `include-services` does internally:**
```
PUT http://localhost:9999/v1/mode
Content-Type: application/json
{
  "mode": "record-many",
  "config": {
    "include-services": "invoicing-api,payment-api"
  }
}
```

---

### UC-7: Resolve and expose mock URLs (sidecar pattern)

**Source:** Needed because `services:` blocks have no output mechanism

**How `resolve-urls` works:** Parses `wiremock.yaml` (and profile overlay if
`profile` is set) to construct `http://localhost:<port>` URLs, then **always**
calls `GET <runner-admin-url>/__/health` to verify the Runner is live before
emitting outputs. This prevents downstream steps from receiving URLs before
the container is ready.

The health check uses the `runner-admin-url` input (default `http://localhost:9999`).
Always verify health — this is the predictable, safe behavior. The step will fail
with F-15 if the Runner is not reachable.

```yaml
- name: Resolve mock service URLs
  id: mocks
  uses: wiremock/wiremock-runner-action@v1
  with:
    command: resolve-urls
    runner-admin-url: http://localhost:9999

- name: Run E2E tests
  run: npx playwright test
  env:
    PAYMENTS_BASE_URL: ${{ fromJson(steps.mocks.outputs.mock-api-urls)['payment-api'] }}
    INVOICING_BASE_URL: ${{ fromJson(steps.mocks.outputs.mock-api-urls)['invoicing-api'] }}
```

**What `resolve-urls` does internally:**
1. Reads `<wiremock-dir>/wiremock.yaml` (and profile overlay if `profile` set)
2. For each service, constructs `http://localhost:<port>`
3. Calls `GET <runner-admin-url>/__/health` — fails with F-15 if not reachable
4. Writes `mock-api-url` (first service) and `mock-api-urls` (JSON map) via `core.setOutput()`
5. Writes `runner-admin-url` output (confirmed live)

---

### UC-8: Promote mocks across environments (full GitOps flow)

**Source:** docs.wiremock.io/runner/promoting-apis-with-git-and-ci — full workflow

```yaml
# .github/workflows/promote-mocks.yml
name: Promote Mock APIs
on:
  workflow_call:
    inputs:
      source-profile:
        required: true
        type: string
      target-profile:
        required: true
        type: string

permissions: {}

jobs:
  promote:
    runs-on: ubuntu-latest
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683  # v4.2.2

      - name: Pull from source environment
        uses: wiremock/wiremock-runner-action@v1
        with:
          api-token: ${{ secrets.WIREMOCK_API_TOKEN }}
          command: pull
          mock-api: mock-api
          all: 'true'
          profile: ${{ inputs.source-profile }}

      - name: Push to target environment
        uses: wiremock/wiremock-runner-action@v1
        with:
          api-token: ${{ secrets.WIREMOCK_API_TOKEN }}
          command: push
          mock-api: mock-api
          all: 'true'
          profile: ${{ inputs.target-profile }}
```

Called via:
```yaml
jobs:
  promote-to-staging:
    uses: ./.github/workflows/promote-mocks.yml
    with:
      source-profile: development
      target-profile: staging
    secrets: inherit
```

---

### UC-9: Batched recording (large sessions)

**Source:** docs.wiremock.io/cli/multi-domain-recording — "Importing recordings as you go"

The Action supports passing Runner config at mode-switch time via the
`runner-config` input:

```yaml
- name: Switch to record-many with batching
  uses: wiremock/wiremock-runner-action@v1
  with:
    command: mode-switch
    target-mode: record-many
    runner-admin-url: http://localhost:9999
    runner-config: |
      max-batch-requests: 50
      max-batch-bytes: 10MB
```

**`runner-config` input:** A YAML string that is parsed and passed as the
`config` field in the mode-switch HTTP body. This allows pass-through of any
undocumented or future Runner config options without requiring Action updates.

---

### UC-10: Cross-job URL sharing

When mock URLs need to be available in a downstream job:

```yaml
permissions: {}

jobs:
  setup:
    runs-on: ubuntu-latest
    permissions:
      contents: read
    outputs:
      mock-urls: ${{ steps.mocks.outputs.mock-api-urls }}
    steps:
      - uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683  # v4.2.2
      - id: mocks
        uses: wiremock/wiremock-runner-action@v1
        with:
          command: resolve-urls

  test:
    needs: setup
    runs-on: ubuntu-latest
    permissions:
      contents: read
    steps:
      - run: curl ${{ fromJson(needs.setup.outputs.mock-urls)['my-api'] }}/health
```

---

## 5. Failure Scenarios and Error Handling

### F-1: Docker not available (ephemeral mode)

**Condition:** `which docker` fails or `docker info` returns non-zero

**Detection:** First step in container lifecycle module

**Action behavior:**
```
::error title=Docker Required::WireMock Runner ephemeral mode requires Docker.
Docker is not available on this runner. Either:
1. Use ubuntu-latest (Docker is pre-installed)
2. Use the sidecar pattern (services: block) instead
See: https://docs.wiremock.io/runner/overview
```
Exit code 1. Post step skips container stop (container never started — check
`core.getState('containerName')` is empty).

---

### F-2: Invalid API token

**Condition:** CLI returns auth error (exit code non-zero, stderr contains
"401" or "Unauthorized" or "Invalid token")

**Action behavior:**
```
::error title=Authentication Failed::WireMock API token is invalid or expired.
Verify WIREMOCK_API_TOKEN secret at:
https://app.wiremock.cloud/account/security
```
Token value is never echoed (masked via `core.setSecret()` before first use).
Exit code propagated.

---

### F-3: Runner health check timeout

**Condition:** `/__/health` does not return 200 within
`health-check-retries * health-check-interval` seconds

**Action behavior:**
1. Captures `docker logs wiremock-runner-<id>` (last 50 lines)
2. Emits as `::group::WireMock Runner startup logs`
3. Emits:
   ```
   ::error title=Runner Startup Failed::WireMock Runner did not become healthy
   within 60 seconds. Check the startup logs above for errors.
   Common causes:
   - Port already in use (check that ports 8080,8081,9999 are free)
   - Invalid WMC_API_TOKEN
   - wiremock.yaml not found at .wiremock/wiremock.yaml
   ```
4. Post step attempts `docker stop` anyway
5. Exit code 1

---

### F-4: Port conflict

**Condition:** `docker run` fails with "port is already allocated" or
"address already in use"

**Detection:** stderr from docker run command

**Action behavior:**
```
::error title=Port Conflict::One or more requested ports (8080, 8081, 9999)
are already in use on this runner. Specify different ports via the `ports`
and `runner-admin-port` inputs, and ensure they match the ports in
wiremock.yaml.
```

---

### F-5: User `run:` command fails

**Condition:** Subprocess exits with non-zero code

**Action behavior:**
- Logs exit code as `::error`
- If mode is `record-many`: **still attempts flush** before stopping
  (recordings up to the failure point may be worth preserving)
- Container stop always runs (post step runs via `post-if: always()`)
- Exit code from user command is propagated — the workflow step fails

---

### F-6: Recording flush fails

**Condition:** `POST /v1/record-many/flush` returns non-200

**Action behavior:**
- Emits `::warning` (not error) with response body
- Sets `recording-flushed: false` via `core.setOutput()`
- Does NOT fail the step by default (recordings in progress > perfect flush)
- Includes note: "Recordings up to the last batch may still have been saved
  if `max-batch-requests` was configured"
- If user wants hard failure, they can check the output:
  ```yaml
  - if: steps.record.outputs.recording-flushed == 'false'
    run: exit 1
  ```

---

### F-7: `wiremock.yaml` not found

**Condition:** `<wiremock-dir>/wiremock.yaml` (resolved from `wiremock-dir` input)
does not exist at runtime

**Action behavior:**
```
::error title=Config Not Found::No wiremock.yaml found at .wiremock/wiremock.yaml
(resolved from workspace root). Ensure:
1. Your repository contains a .wiremock directory with wiremock.yaml
2. The checkout step ran before this Action
3. If using a custom path, set the `wiremock-dir` input
```

---

### F-8: Profile file does not exist for push/pull

**Condition:** `--profile staging` passed but `wiremock-staging.yaml` absent

**Detection:** CLI stderr contains "profile file not found" or similar

**Action behavior:**
```
::error title=Profile Not Found::Environment profile 'staging' not found.
Expected file: .wiremock/wiremock-staging.yaml
Run the environments-create command first:
  uses: wiremock/wiremock-runner-action@v1
  with:
    command: environments-create
    profile: staging
```

---

### F-9: environments-create — profile already exists

**Condition:** `wiremock-<profile>.yaml` already exists

**Default behavior (`force: 'false'`):** Emit `::notice` and skip (idempotent)

**With `force: 'true'`:** Fail with:
```
::error title=Profile Already Exists::Environment profile 'staging' already exists
at .wiremock/wiremock-staging.yaml. The CLI does not support overwriting an existing
environment. Delete the file manually if you intended to recreate it.
```
(The CLI does not support overwrite — this is intentional to prevent accidental
data loss.)

---

### F-10: Container left running after cancelled workflow

**Condition:** Workflow is cancelled mid-run

**Mitigation:** The post step uses `post-if: always()` which runs on
cancellation. The runner sends SIGINT (7.5s grace), then SIGTERM (2.5s), then
force-kills. Container cleanup has ~10 seconds — the `docker stop` command is
issued immediately in the post step with no additional delay.

**Note on GitHub-hosted runners:** a leftover container doesn't actually
matter here — each hosted job runs on a single-use VM that's destroyed
immediately after the job ends (cancelled or not), taking any orphaned
container with it. A `workflow_run` cleanup job was tried (commit `606c0f8`)
but is fundamentally unworkable: `workflow_run` fires on a *fresh, unrelated*
runner VM, which has no visibility into the cancelled job's containers (they
were on a different VM that's already gone). Don't reintroduce this pattern.

**Residual gap (self-hosted runners only):** on a self-hosted runner reused
across jobs, a container that outlives its ~10-second grace window on
cancellation can leak and accumulate, since there's no VM teardown to reclaim
it. Container names include `github.run_id` + `github.job` + a random suffix
(see §6c), so leaked containers are at least identifiable and won't collide
with future runs — but nothing currently reaps them. If this becomes a real
problem for self-hosted users, the fix is a periodic (`schedule:`-triggered)
job on the same self-hosted runner pool that stops containers older than
some threshold — not a `workflow_run`-based reaction to a specific cancelled
run.

---

### F-11: mode-switch to record-many — Runner already recording

**Condition:** Runner is already in record-many mode when mode-switch called

**Action behavior:** Emit `::warning`, proceed (the Runner handles this
gracefully — a second switch to the same mode is a no-op in the Runner API)

---

### F-12: Windows runner (ephemeral mode)

**Condition:** `runner.os == 'Windows'` and `run:` input is present

**Action behavior:**
```
::error title=Unsupported Runner OS::Ephemeral container mode requires
Docker (Linux containers) and is not supported on Windows runners.
Use ubuntu-latest, or use the sidecar services: pattern.
```

---

### F-13: Docker image tag not found

**Condition:** `docker run` fails because `wiremock/wiremock-runner:<version>`
does not exist on Docker Hub (e.g. a typo in `runner-version`)

**Detection:** stderr from docker run contains "Unable to find image" or
"manifest unknown" or docker exits with code 125

**Action behavior:**
```
::error title=Runner Image Not Found::Docker image wiremock/wiremock-runner:<version>
could not be pulled. Check that the version tag exists:
https://hub.docker.com/r/wiremock/wiremock-runner/tags
Use runner-version: 'latest' to always pull the most recent release.
```

---

### F-14: Transient network error during push/pull

**Condition:** CLI exits with non-zero due to a network timeout or transient
5xx from WireMock Cloud during push/pull

**Detection:** stderr contains "ECONNRESET", "ETIMEDOUT", "503", "502", or
"network error" (case-insensitive)

**Action behavior:**
- Emits `::warning` with the raw error and suggestion to retry
- Propagates the non-zero exit code (step fails)
- Includes note in warning:
  ```
  This may be a transient network error. Re-running the job is safe —
  push and pull operations are idempotent.
  ```

---

### F-15: `runner-admin-url` unreachable at command execution time

**Condition:** Commands that require a live Runner (`record-flush`,
`record-stop`, `record-flush-and-stop`, `mode-switch`, `resolve-urls` with
health check) cannot reach `<runner-admin-url>/__/health`

**When detected:** At command execution time (not at input validation time —
the Runner may not be running when inputs are first parsed).

**Action behavior:**
```
::error title=Runner Not Reachable::Cannot connect to WireMock Runner at
http://localhost:9999. Ensure:
1. The Runner container or service is started and healthy before this step
2. The runner-admin-url input matches the port the Runner is listening on
3. If using a sidecar (services:), add a health check to the service definition
```

---

## 6. Implementation Details

### 6a. Input parsing and validation (inputs.ts)

Use **Zod** for schema-based validation. This provides runtime type safety and
clear error messages surfaced via `core.setFailed()`.

```typescript
import { z } from 'zod'
import * as core from '@actions/core'

const InputSchema = z.object({
  'api-token':              z.string().optional(),
  'wiremock-dir':           z.string().default('.wiremock'),
  run:                      z.string().optional(),
  mode:                     z.enum(['serve', 'record-many']).default('serve'),
  ports:                    z.string().default('8080'),
  'runner-admin-port':      z.coerce.number().int().positive().default(9999),
  'runner-version':         z.string().default('latest'),
  profile:                  z.string().optional(),
  'post-run-pull':          z.enum(['true', 'false']).transform(v => v === 'true').default('false'),
  command:                  z.enum([
    'push', 'pull', 'environments-create',
    'record-flush', 'record-stop', 'record-flush-and-stop',
    'mode-switch', 'resolve-urls',
  ]).optional(),
  'mock-api':               z.string().optional(),
  all:                      z.enum(['true', 'false']).transform(v => v === 'true').default('false'),
  'runner-admin-url':       z.string().url().default('http://localhost:9999'),
  'include-services':       z.string().optional(),
  'target-mode':            z.enum(['serve', 'record-many']).optional(),
  'runner-config':          z.string().optional(),
  force:                    z.enum(['true', 'false']).transform(v => v === 'true').default('false'),
  'wiremock-cli-version':   z.string().default('latest'),
  'health-check-retries':   z.coerce.number().int().positive().default(30),
  'health-check-interval':  z.coerce.number().positive().default(2),
}).superRefine((data, ctx) => {
  // Mutual exclusion: exactly one of run or command
  if (data.run && data.command) {
    ctx.addIssue({ code: z.ZodIssueCode.custom,
      message: 'Inputs `run` and `command` are mutually exclusive. Set one or the other.' })
  }
  if (!data.run && !data.command) {
    ctx.addIssue({ code: z.ZodIssueCode.custom,
      message: 'One of `run` or `command` must be set.' })
  }
  // API token required for cloud operations
  const cloudCommands = ['push', 'pull', 'environments-create']
  if (data.command && cloudCommands.includes(data.command) && !data['api-token']) {
    ctx.addIssue({ code: z.ZodIssueCode.custom,
      message: `Input \`api-token\` is required for command: ${data.command}` })
  }
  // target-mode required for mode-switch
  if (data.command === 'mode-switch' && !data['target-mode']) {
    ctx.addIssue({ code: z.ZodIssueCode.custom,
      message: '`target-mode` is required when command is `mode-switch`' })
  }
  // post-run-pull requires api-token (ephemeral mode, not covered by cloud command check above)
  if (data['post-run-pull'] && !data['api-token']) {
    ctx.addIssue({ code: z.ZodIssueCode.custom,
      message: '`api-token` is required when `post-run-pull` is true' })
  }
  // Port format: all values must be valid integers 1–65535 before conflict check
  const portStrings = data.ports.split(',').map(p => p.trim())
  const mockPorts: number[] = []
  for (const p of portStrings) {
    const n = parseInt(p, 10)
    if (isNaN(n) || n < 1 || n > 65535 || String(n) !== p) {
      ctx.addIssue({ code: z.ZodIssueCode.custom,
        message: `Invalid port value "${p}" in \`ports\` input. All values must be integers between 1 and 65535.` })
      return  // stop further port checks — they would operate on NaN
    }
    mockPorts.push(n)
  }
  // Ports must not conflict with runner-admin-port
  if (mockPorts.includes(data['runner-admin-port'])) {
    ctx.addIssue({ code: z.ZodIssueCode.custom,
      message: `runner-admin-port (${data['runner-admin-port']}) conflicts with a value in ports` })
  }
})

export function getInputs() {
  const raw = Object.fromEntries(
    Object.keys(InputSchema.shape).map(k => [k, core.getInput(k)])
  )
  const result = InputSchema.safeParse(raw)
  if (!result.success) {
    core.setFailed(`Invalid inputs:\n${JSON.stringify(result.error.format(), null, 2)}`)
    process.exit(1)
  }
  return result.data
}
```

**Important:** `runner-admin-url` reachability is **not** checked at input
validation time. Commands that need a live Runner verify reachability at
execution time (see F-15). This prevents false failures when the Runner is
still starting in a previous step.

### 6b. Token masking

The very first operation after `getInputs()` returns — before any `core.info()`
or logging — must be:

```typescript
if (inputs.apiToken) {
  core.setSecret(inputs.apiToken)
}
```

This ensures the token is redacted in all subsequent log output, including
docker run commands that contain it as an env var.

### 6c. Container naming

```
wiremock-runner-${GITHUB_RUN_ID}-${GITHUB_JOB}-${randomSuffix}
```

`randomSuffix` is a 6-character hex string generated at action startup via
`crypto.randomBytes(3).toString('hex')`. This guarantees uniqueness across
matrix legs that share the same `GITHUB_JOB` name (matrix jobs have identical
job names — only the matrix values differ, and those are not available as env
vars without explicit user opt-in).

**Why not `run_id` + `job` alone:** In a matrix build with
`strategy.matrix.node: [18, 20, 22]` on a single self-hosted runner, all three
legs share the same `GITHUB_JOB` value. A deterministic name like
`wiremock-runner-123-test` would collide. The random suffix is generated once
per Action invocation and saved to state so the post step can look it up.

The container name is still filterable by prefix for the cleanup workflow:
`docker ps --filter "name=wiremock-runner-" -q`.

```typescript
import { randomBytes } from 'crypto'

const suffix = randomBytes(3).toString('hex')
const containerName = `wiremock-runner-${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_JOB}-${suffix}`
core.saveState('containerName', containerName)
core.saveState('isPost', 'true')
```

**Known limitation:** Port allocation in matrix builds is the user's
responsibility. Two matrix legs cannot bind the same host port. Users in matrix
builds must parameterize `ports` and `runner-admin-port` per matrix leg.

### 6d. wiremock.yaml parsing (yaml-reader.ts)

The `wiremock-dir` input is resolved relative to `process.env.GITHUB_WORKSPACE`,
with a **path traversal guard** to ensure the resolved path stays within the
workspace:

```typescript
const workspace = process.env.GITHUB_WORKSPACE ?? process.cwd()
const wiremockDir = path.resolve(workspace, inputs.wiremockDir)

// Path traversal guard — must come before any file I/O or volume mount
if (!wiremockDir.startsWith(workspace + path.sep) && wiremockDir !== workspace) {
  core.setFailed(
    `Invalid wiremock-dir: resolved path "${wiremockDir}" is outside the workspace "${workspace}". ` +
    `Do not use paths containing ".." or absolute paths outside the workspace.`
  )
  process.exit(1)
}

const configPath = path.join(wiremockDir, 'wiremock.yaml')
```

The same resolved `wiremockDir` is used as the Docker volume mount source:
```
-v ${wiremockDir}:/work/.wiremock
```

Parse the base YAML, then apply profile overlay if `profile` input is set.
Extract:
- Service keys and their ports (for container `-p` flags and URL map)
- `cloud_id` values (for validation in push/pull)

Profile overlay logic mirrors the CLI: overlay file keys override base file
keys, `type` cannot be changed.

### 6e. Post step behavior

The `runs.post` entry points to the same `dist/index.js`. The entry point
checks `STATE_isPost` (set via `core.saveState` in the main run) to determine
it is running in post mode, then only executes container cleanup.

```typescript
// main.ts
if (core.getState('isPost') === 'true') {
  await runPostStep()
} else {
  core.saveState('isPost', 'true')
  await runMainStep()
}
```

Post step cleanup:
```typescript
async function runPostStep() {
  const containerName = core.getState('containerName')
  if (!containerName) return  // ephemeral mode never started
  try {
    // --time 5: allow 5s for graceful shutdown, then SIGKILL.
    // Must complete within the ~10s post-step grace window on cancellation.
    await exec.exec('docker', ['stop', '--time', '5', containerName])
  } catch {
    core.warning(`Could not stop container ${containerName} — it may have already exited.`)
  }
}
```

### 6f. CLI installation caching

Use `@actions/tool-cache` to cache the installed CLI between runs on
self-hosted runners. On GitHub-hosted runners, the cache is per-run so
caching is less valuable but still implemented for consistency.

### 6g. Step summaries (summary.ts)

All significant operations emit a step summary via `core.summary`:

```typescript
await core.summary
  .addHeading('WireMock Runner')
  .addTable([
    [{ data: 'Operation', header: true }, { data: 'Result', header: true }],
    [command, success ? '✅ Success' : '❌ Failed'],
  ])
  .addRaw(`\n**Mock API URLs:** \`${mockApiUrls}\``)
  .write()
```

Keep summaries under 512 KiB (well below the 1 MiB limit). Truncate large
log excerpts to 50 lines with a note that full logs are in the job log.

---

## 7. Testing Strategy

### 7a. Unit tests

- `inputs.test.ts`: All Zod validation branches, defaults, mutual exclusion,
  edge cases (empty strings, invalid enums, port conflicts)
- `port-resolver.test.ts`: YAML parsing with and without profile overlay,
  edge cases (single service, many services, dynamic port 0)
- `yaml-reader.test.ts`: Missing file, malformed YAML, profile override rules,
  custom `wiremock-dir` paths
- `post-step.test.ts`: State restoration, missing container name (no-op),
  docker stop failure (warning not error)

### 7b. Integration tests (against real WireMock Cloud)

These require a `WIREMOCK_API_TOKEN` secret. They run in a separate CI job
**gated on secret availability** using an environment (`integration-tests`).

**Fork PR strategy:** Fork PRs cannot access secrets via `pull_request`.
Use the `workflow_run` pattern:

```yaml
# .github/workflows/integration.yml
name: Integration Tests
on:
  workflow_run:
    workflows: ['CI']
    types: [completed]

permissions: {}

jobs:
  integration:
    runs-on: ubuntu-latest
    if: github.event.workflow_run.conclusion == 'success'
    environment: integration-tests    # gate: requires maintainer approval for forks
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683  # v4.2.2
        with:
          ref: ${{ github.event.workflow_run.head_sha }}
      - uses: actions/setup-node@cdca7365b2dadb8aad0a33bc7601856ffabcc48e  # v4
        with:
          node-version-file: '.nvmrc'
          cache: 'npm'
      - run: npm ci
      - run: npm test -- --testPathPattern=tests/integration
        env:
          WIREMOCK_API_TOKEN: ${{ secrets.WIREMOCK_API_TOKEN }}
```

- `push-pull.test.ts`:
  - Push stubs to a test environment
  - Verify via WireMock Cloud API that stubs are present
  - Pull back and verify files match

- `ephemeral-serve.test.ts`:
  - Start ephemeral serve container with test stubs
  - Run `curl` against mock URL from output
  - Verify response matches stub definition
  - Verify container is gone after step completes

- `ephemeral-record.test.ts`:
  - Start ephemeral record-many container
  - Make real HTTP requests through the proxy
  - Verify flush succeeds
  - Pull and verify stubs were created

### 7c. Failure scenario tests

Each F-N scenario above gets a test case that triggers the condition and
asserts the correct error message format and exit code.

---

## 8. `action.yml` Behavior Matrix

| `run` set | `command` set | Behavior                     |
|-----------|---------------|------------------------------|
| ✓         |               | Ephemeral container mode     |
|           | ✓             | CLI command mode             |
| ✓         | ✓             | **Error:** mutually exclusive|
|           |               | **Error:** one must be set   |

```
::error title=Invalid Inputs::Inputs `run` and `command` are mutually exclusive.
```

| `command` value          | Requires `api-token` | Requires live Runner at `runner-admin-url` |
|--------------------------|---------------------|---------------------------------------------|
| `push`                   | ✓                   |                                             |
| `pull`                   | ✓                   |                                             |
| `environments-create`    | ✓                   |                                             |
| `record-flush`           |                     | ✓ (verified at execution time)              |
| `record-stop`            |                     | ✓ (verified at execution time)              |
| `record-flush-and-stop`  |                     | ✓ (verified at execution time)              |
| `mode-switch`            |                     | ✓ (verified at execution time)              |
| `resolve-urls`           |                     | ✓ Always verifies health (verified at execution time) |

---

## 9. README Structure (Marketplace Listing)

The README is the Marketplace listing. Structure it in this order:

1. **One-line description** + badges (version, license, verified)
2. **Quick start** — minimal working example (5 lines of YAML)
3. **Prerequisites** — `actions/checkout@v4` must run before this Action;
   `WIREMOCK_API_TOKEN` secret must be configured for cloud operations
4. **Pattern 1: Run tests against mock APIs** — full working example
5. **Pattern 2: Record API traffic** — full working example
6. **Pattern 3: Push/pull mock specs** — full working example
7. **Environment promotion workflow** — the GitOps flow
8. **Complete input reference** — table of all inputs with types and defaults
9. **Outputs reference** — table of all outputs
10. **GitHub Secrets setup** — exactly what to create and where to find values
11. **Runner OS compatibility** — ubuntu-latest ✓, macos-latest ✓ (Docker required for ephemeral), windows-latest ✗ (ephemeral only)
12. **Troubleshooting** — maps to F-N scenarios above
13. **Version pinning guidance** — pin to `@v1` or `@v1.2.3`, never `@main`;
    SHA-pinning example with Dependabot note

---

## 10. Marketplace Publication Checklist

- [ ] `action.yml` present at repo root
- [ ] `name` is globally unique on Marketplace
- [ ] `branding.icon` is a valid Feather icon name
- [ ] `README.md` present with at least one usage example
- [ ] Public repository
- [ ] Semantic version tag created (e.g. `v1.0.0`)
- [ ] Floating major version tag maintained (`v1` → latest v1.x.x)
- [ ] Release created from tag (this surfaces the "Draft a release" Marketplace banner)
- [ ] Categories selected: Testing (primary), Continuous Integration (secondary)
- [ ] `LICENSE` file present (Apache 2.0 recommended for tooling)
- [ ] Apply for Verified Creator badge: partnerships@github.com
- [ ] All secrets documented — token value never appears in test fixtures or CI logs
- [ ] `dist/index.js` committed (users reference the repo directly; they do not run npm install)
- [ ] `dist/` is NOT in `.gitignore`
- [ ] `.github/dependabot.yml` configured for both `github-actions` and `npm` ecosystems

---

## 11. Build and Release Process

### Bundler: tsup

```bash
# Install deps
npm ci

# Compile + bundle to single file
npm run build
# internally: tsup (config in tsup.config.ts — CJS, bundled, minified)

# Verify bundle is valid
node -e "require('./dist/index.js')"  # should not throw

# Commit dist
git add dist/
git commit -m "build: bundle for release"

# Tag
git tag -a v1.0.0 -m "v1.0.0"
git tag -fa v1 -m "Update v1 tag"
git push origin v1.0.0 v1 --force-with-lease
```

### CI Workflow — PR checks (no secrets needed)

`.github/workflows/ci.yml`:
```yaml
name: CI
on:
  push:
    branches: [main]
  pull_request:

permissions: {}

jobs:
  lint-and-test:
    runs-on: ubuntu-latest
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683  # v4.2.2

      - uses: actions/setup-node@cdca7365b2dadb8aad0a33bc7601856ffabcc48e  # v4
        with:
          node-version-file: '.nvmrc'
          cache: 'npm'

      - run: npm ci
      - run: npm run lint
      - run: npx tsc --noEmit        # type-check without emitting — tsup won't catch type errors
      - run: npm test -- --testPathPattern=tests/unit

      - name: Build and verify dist is up to date
        run: |
          npm run build
          if [ -n "$(git status dist/ --porcelain)" ]; then
            echo "::error::dist/ is out of date. Run npm run build and commit the result."
            exit 1
          fi
```

### CI Workflow — Release

`.github/workflows/release.yml`:
```yaml
name: Release
on:
  push:
    tags: ['v*']

permissions: {}

jobs:
  release:
    runs-on: ubuntu-latest
    permissions:
      contents: write
    steps:
      - uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683  # v4.2.2

      - uses: actions/setup-node@cdca7365b2dadb8aad0a33bc7601856ffabcc48e  # v4
        with:
          node-version-file: '.nvmrc'
          cache: 'npm'

      - run: npm ci
      - run: npm run lint
      - run: npx tsc --noEmit        # type-check without emitting
      - run: npm test -- --testPathPattern=tests/unit
      - run: npm run build

      - name: Verify dist is committed and up to date
        run: |
          if [ -n "$(git status dist/ --porcelain)" ]; then
            echo "::error::dist/ is out of date. Run npm run build and commit."
            exit 1
          fi

      - name: Create GitHub Release
        uses: softprops/action-gh-release@01570a1f39cb168c169c802c3bceb9e93fb10974  # v2
        with:
          generate_release_notes: true

      - name: Update floating major version tag
        # Move the v1 tag to point at the new release commit
        run: |
          MAJOR_TAG=$(echo "${GITHUB_REF_NAME}" | grep -oP '^v\d+')
          git config user.name  "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git tag -fa "${MAJOR_TAG}" -m "Update ${MAJOR_TAG} to ${GITHUB_REF_NAME}"
          git push origin "${MAJOR_TAG}" --force-with-lease
```

### Dependabot Configuration

`.github/dependabot.yml`:
```yaml
version: 2
updates:
  # Keep workflow action references up to date (SHA + version comment)
  - package-ecosystem: "github-actions"
    directory: "/"
    schedule:
      interval: "weekly"
    commit-message:
      prefix: "chore(deps)"

  # Keep @actions/core, zod, tsup, etc. up to date
  - package-ecosystem: "npm"
    directory: "/"
    schedule:
      interval: "weekly"
    commit-message:
      prefix: "chore(deps)"
```

Dependabot reads the `# vX.Y.Z` comment on SHA-pinned actions and opens PRs
updating both the SHA and the comment automatically.

---

## 12. Known Constraints and Decisions

| Constraint | Decision |
|---|---|
| `services:` blocks cannot be generated by an Action | Pattern 2 requires manual `services:` block; Action covers step-level operations only. Document clearly. |
| GitHub-hosted Windows runners don't support Linux containers | Ephemeral mode fails fast with clear error on Windows (F-12). Sidecar pattern is unaffected. |
| `post` step not guaranteed on hard cancellation | `post-if: always()` handles cancellation. Document cleanup workflow for edge cases (F-10). Container names are deterministic so manual cleanup is straightforward. |
| CLI requires Node 18+ | The Action installs Node via `setup-node` before CLI install. If Node is already ≥18, the install is a no-op. |
| `wiremock config set api_token` writes to `~/.config/wiremock-cli/` | On self-hosted runners, this persists between runs. The Action always overwrites it; no stale token risk. |
| Multiple matrix jobs on same self-hosted runner | Container name includes `GITHUB_RUN_ID` + `GITHUB_JOB` + a random 6-char hex suffix generated per invocation. Matrix legs sharing the same job name (which is all of them) get unique containers. Port allocation is the user's responsibility — ports must be parameterized per matrix leg. |
| `flush` must be called before mode-switch or container stop | Documented. In ephemeral mode the Action always calls flush when in record-many mode. In sidecar mode, the `record-flush-and-stop` command does both atomically. |
| Node runtime | `node24` — Node 20 reaches EOL April 2026 and is deprecated on Actions runners. Node 22 is not and will not be supported by the runner. |
| Action outputs `value:` | Omitted — `value:` in outputs is only valid for composite actions. JS actions set outputs via `core.setOutput()`. |
| SHA pinning in examples | All `uses:` references in example workflows use full commit SHAs with `# vX.Y.Z` comments. Dependabot keeps these current. |
| Fork PR integration tests | Use `workflow_run` event with an environment gate (`integration-tests` environment requires maintainer approval for fork PRs). |
| `wiremock-dir` volume mount | The Docker volume source uses the resolved value of the `wiremock-dir` input, not a hardcoded `.wiremock` path. |
| `resolve-urls` behavior | Parses `wiremock.yaml` for URL construction, then always calls `GET <runner-admin-url>/__/health` before emitting outputs. Health check is not optional — this is the safe, predictable behavior. |
| `runner-admin-url` validation | Reachability is checked lazily at command execution time, not at input parse time, to avoid false failures when the Runner is starting in a previous step. |
| WireMock Cloud rate limits | The CLI handles rate limiting internally. For large push/pull operations, document that Cloud API limits may apply and retrying is safe (operations are idempotent). |
