/**
 * An error that maps directly to an HTTP response. Throw it from a route
 * handler and the central error handler turns it into `{ error: message }`.
 */
export class HttpError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.name = 'HttpError';
    this.statusCode = statusCode;
  }

  static badRequest(message) {
    return new HttpError(400, message);
  }

  static notFound(message) {
    return new HttpError(404, message);
  }

  static conflict(message) {
    return new HttpError(409, message);
  }
}

/**
 * Await a Prisma write that targets a single record and translate
 * "record not found" (P2025) into a 404 with a route-specific message.
 */
export async function orNotFound(promise, message) {
  try {
    return await promise;
  } catch (error) {
    if (error?.code === 'P2025') throw HttpError.notFound(message);
    throw error;
  }
}
