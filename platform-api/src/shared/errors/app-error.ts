export interface ErrorDetails {
  [key: string]: unknown;
}

export class AppError extends Error {
  constructor(
    public readonly code: string,
    public readonly statusCode: number,
    message: string,
    public readonly details?: ErrorDetails
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class ValidationError extends AppError {
  constructor(message = "Validation failed", details?: ErrorDetails) {
    super("VALIDATION_ERROR", 400, message, details);
  }
}

export class AuthenticationError extends AppError {
  constructor(message = "Authentication required") {
    super("AUTHENTICATION_REQUIRED", 401, message);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "Access denied", details?: ErrorDetails) {
    super("ACCESS_DENIED", 403, message, details);
  }
}

export class NotFoundError extends AppError {
  constructor(message = "Resource not found", details?: ErrorDetails) {
    super("NOT_FOUND", 404, message, details);
  }
}

export class ConflictError extends AppError {
  constructor(message = "Conflict", details?: ErrorDetails) {
    super("CONFLICT", 409, message, details);
  }
}

export class ServiceUnavailableError extends AppError {
  constructor(message = "Service temporarily unavailable", details?: ErrorDetails) {
    super("SERVICE_UNAVAILABLE", 503, message, details);
  }
}
