/** A failure a route can turn into an HTTP status. Messages are safe to show to the user. */
export class ServiceError extends Error {
  constructor(
    readonly status: 400 | 401 | 403 | 404 | 409 | 410 | 429 | 502 | 503,
    readonly code: string,
    message: string,
    /** Extra fields for the error body, e.g. the current text in a doc conflict. */
    readonly data?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ServiceError";
  }
}

export const notFound = (what = "Not found") => new ServiceError(404, "not_found", what);
export const forbidden = (code = "forbidden", message = "You do not have access to do that.") =>
  new ServiceError(403, code, message);
export const badRequest = (message: string) => new ServiceError(400, "invalid", message);
export const conflict = (code: string, message: string, data?: Record<string, unknown>) => new ServiceError(409, code, message, data);
export const unavailable = (code: string, message: string) => new ServiceError(503, code, message);
