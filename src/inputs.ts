import { z } from 'zod'
import * as core from '@actions/core'
import { ActionFatalError } from './errors'

// Semver tag: "latest" or "1.2.3" or "1.2.3-beta.1"
const VERSION_PATTERN = /^(latest|[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9._-]+)?)$/

// Identifier safe for use as a CLI arg and filename component
const NAME_PATTERN = /^[a-zA-Z0-9_-]+$/

// Allow localhost, 127.x, RFC 1918 IPs, and DNS hostnames (for Docker Compose sidecars).
// Blocks link-local IPs (169.254.x.x) which are used by cloud IMDS endpoints.
function isSafeAdminUrl(raw: string): boolean {
  let hostname: string
  try {
    hostname = new URL(raw).hostname
  } catch {
    return false
  }
  const ipv4 = hostname.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/)
  if (!ipv4) return true // DNS hostname — allow (e.g. "wiremock-runner" in Docker Compose)
  const [a, b] = [Number(ipv4[1]), Number(ipv4[2])]
  return (
    a === 127 ||                         // loopback
    a === 10 ||                          // RFC 1918
    (a === 172 && b >= 16 && b <= 31) || // RFC 1918
    (a === 192 && b === 168)             // RFC 1918
  )
}

// Define the base object schema separately so we can access .shape for input key enumeration.
// superRefine() wraps the schema in ZodEffects which loses the .shape property.
const InputBaseSchema = z.object({
    'api-token': z.string().optional(),
    'wiremock-dir': z.string().default('.wiremock'),
    run: z.string().optional(),
    mode: z.enum(['serve', 'record-many']).default('serve'),
    ports: z.string().default('8080'),
    'runner-admin-port': z.coerce.number().int().positive().default(9999),
    'runner-version': z.string().default('latest')
      .refine(v => VERSION_PATTERN.test(v), 'runner-version must be "latest" or a semver tag like 1.2.3'),
    profile: z.string().optional()
      .refine(v => !v || NAME_PATTERN.test(v), 'profile must contain only letters, numbers, hyphens, and underscores'),
    'post-run-pull': z
      .enum(['true', 'false'])
      .transform(v => v === 'true')
      .default('false'),
    command: z
      .enum([
        'push',
        'pull',
        'environments-create',
        'record-flush',
        'record-stop',
        'record-flush-and-stop',
        'mode-switch',
        'resolve-urls',
      ])
      .optional(),
    'mock-api': z.string().optional()
      .refine(v => !v || NAME_PATTERN.test(v), 'mock-api must contain only letters, numbers, hyphens, and underscores'),
    all: z
      .enum(['true', 'false'])
      .transform(v => v === 'true')
      .default('false'),
    'runner-admin-url': z.string().url()
      .refine(isSafeAdminUrl, 'runner-admin-url must target localhost, a private IP, or a Docker Compose service hostname — not a public IP or cloud metadata endpoint')
      .default('http://localhost:9999'),
    'include-services': z.string().optional(),
    'target-mode': z.enum(['serve', 'record-many']).optional(),
    'runner-config': z.string().optional(),
    force: z
      .enum(['true', 'false'])
      .transform(v => v === 'true')
      .default('false'),
    'wiremock-cli-version': z.string().default('latest')
      .refine(v => VERSION_PATTERN.test(v), 'wiremock-cli-version must be "latest" or a semver tag like 1.2.3'),
    'health-check-retries': z.coerce.number().int().positive().default(30),
    'health-check-interval': z.coerce.number().positive().default(2),
  })

const InputSchema = InputBaseSchema.superRefine((data, ctx) => {
    // Mutual exclusion: exactly one of run or command
    if (data.run && data.command) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Inputs `run` and `command` are mutually exclusive. Set one or the other.',
      })
    }
    if (!data.run && !data.command) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'One of `run` or `command` must be set.',
      })
    }

    // API token required for cloud operations
    const cloudCommands = ['push', 'pull', 'environments-create']
    if (data.command && cloudCommands.includes(data.command) && !data['api-token']) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Input \`api-token\` is required for command: ${data.command}`,
      })
    }

    // target-mode required for mode-switch
    if (data.command === 'mode-switch' && !data['target-mode']) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: '`target-mode` is required when command is `mode-switch`',
      })
    }

    // post-run-pull requires api-token
    if (data['post-run-pull'] && !data['api-token']) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: '`api-token` is required when `post-run-pull` is true',
      })
    }

    // Port format: all values must be valid integers 1–65535
    const portStrings = data.ports.split(',').map(p => p.trim())
    const mockPorts: number[] = []
    for (const p of portStrings) {
      const n = parseInt(p, 10)
      if (isNaN(n) || n < 1 || n > 65535 || String(n) !== p) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Invalid port value "${p}" in \`ports\` input. All values must be integers between 1 and 65535.`,
        })
        return // stop further port checks
      }
      mockPorts.push(n)
    }

    // Ports must not conflict with runner-admin-port
    if (mockPorts.includes(data['runner-admin-port'])) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `runner-admin-port (${data['runner-admin-port']}) conflicts with a value in ports`,
      })
    }
  })

export type Inputs = z.output<typeof InputSchema>

export function getInputs(): Inputs {
  // Build raw input map from all schema keys.
  // Convert empty strings to undefined so Zod defaults and optional fields
  // work correctly — GitHub Actions core.getInput() returns '' for unset inputs.
  const raw = Object.fromEntries(
    Object.keys(InputBaseSchema.shape).map(k => {
      const v = core.getInput(k)
      return [k, v === '' ? undefined : v]
    })
  )

  const result = InputSchema.safeParse(raw)
  if (!result.success) {
    core.setFailed(`Invalid inputs:\n${JSON.stringify(result.error.format(), null, 2)}`)
    throw new ActionFatalError()
  }
  return result.data
}
