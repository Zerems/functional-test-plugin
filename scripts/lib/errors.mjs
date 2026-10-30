/** Errors shared across modules. */

/** Thrown when environment variables holding credentials are missing. */
export class MissingSecretError extends Error {
  constructor(variables) {
    super(`missing environment variables: ${variables.join(', ')}`);
    this.name = 'MissingSecretError';
    this.variables = variables;
  }
}

/** Thrown for a non-OK tracker HTTP response; carries the status and the path (no query, no body). */
export class TrackerError extends Error {
  constructor(message, { status, path }) {
    super(message);
    this.name = 'TrackerError';
    this.status = status;
    this.path = path;
  }
}
