export class HttpError extends Error {
  constructor(statusCode, code, message) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

export const invalidCredentials = () => new HttpError(401, 'INVALID_CREDENTIALS', 'Organization, email, or password is incorrect');
export const unauthorized = () => new HttpError(401, 'UNAUTHORIZED', 'Please sign in to continue');
