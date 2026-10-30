/** Errors shared across modules. */

/** Thrown when environment variables holding credentials are missing. */
export class MissingSecretError extends Error {
  constructor(variables) {
    super(`missing environment variables: ${variables.join(', ')}`);
    this.name = 'MissingSecretError';
    this.variables = variables;
  }
}
