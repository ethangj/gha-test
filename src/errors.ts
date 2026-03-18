/**
 * Thrown to abort the action with a fatal error.
 * `core.setFailed` must be called before throwing so the Actions UI shows the
 * correct error annotation. The top-level handler skips the second setFailed
 * call when it sees this type.
 */
export class ActionFatalError extends Error {
  constructor(message = 'Action failed') {
    super(message)
    this.name = 'ActionFatalError'
  }
}
