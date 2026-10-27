import { ErrorCodes } from './protocol.js';

const HTTP_STATUS = {
  [ErrorCodes.BAD_REQUEST]: 400,
  [ErrorCodes.UNAUTHORIZED]: 401,
  [ErrorCodes.FORBIDDEN]: 403,
  [ErrorCodes.NOT_FOUND]: 404,
  [ErrorCodes.CONFLICT]: 409,
  [ErrorCodes.RATE_LIMITED]: 429,
  [ErrorCodes.INTERNAL]: 500,
};

/** An expected, client-facing error. Its message is safe to expose. */
export class AppError extends Error {
  /**
   * @param {string} code one of ErrorCodes
   * @param {string} message
   */
  constructor(code, message) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = HTTP_STATUS[code] ?? 500;
  }
}
