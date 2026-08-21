const configuredBaseUrl = String(window.WILDLEAF_CONFIG?.apiBaseUrl || "")
  .trim()
  .replace(/\/+$/, "");

export class ApiError extends Error {
  constructor(
    message,
    { code = "REQUEST_FAILED", status = 0, details = null } = {},
  ) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export async function apiRequest(path, options = {}) {
  const controller = new AbortController();
  const timeout = window.setTimeout(
    () => controller.abort(),
    options.timeoutMs || 20000,
  );
  const headers = new Headers(options.headers || {});
  headers.set("Accept", "application/json");

  if (options.body !== undefined) {
    headers.set("Content-Type", "application/json");
  }
  if (options.idempotencyKey) {
    headers.set("Idempotency-Key", options.idempotencyKey);
  }

  try {
    const response = await fetch(`${configuredBaseUrl}${path}`, {
      method: options.method || "GET",
      headers,
      body:
        options.body === undefined ? undefined : JSON.stringify(options.body),
      cache: options.cache || "no-store",
      credentials: "omit",
      signal: controller.signal,
    });

    let data;
    try {
      data = await response.json();
    } catch {
      throw new ApiError(
        "Wildleaf returned an unreadable response. Please try again.",
        {
          status: response.status,
        },
      );
    }

    if (!response.ok) {
      const error = data?.error || {};
      throw new ApiError(
        error.message || "The request could not be completed.",
        {
          code: error.code || "REQUEST_FAILED",
          status: response.status,
          details: error.details || null,
        },
      );
    }

    return data;
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new ApiError(
        "The request took too long. Check your connection and try again.",
        {
          code: "REQUEST_TIMEOUT",
        },
      );
    }
    if (error instanceof ApiError) throw error;
    throw new ApiError(
      "Wildleaf could not be reached. Check your connection and try again.",
      {
        code: "NETWORK_ERROR",
      },
    );
  } finally {
    window.clearTimeout(timeout);
  }
}

export function newIdempotencyKey(operation) {
  const id =
    typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) =>
          byte.toString(16).padStart(2, "0"),
        ).join("");
  return `${operation}-${id}`;
}

export function loadBookingSession(publicSlug) {
  try {
    return (
      JSON.parse(sessionStorage.getItem(sessionKey(publicSlug)) || "{}") || {}
    );
  } catch {
    return {};
  }
}

export function saveBookingSession(publicSlug, value) {
  sessionStorage.setItem(sessionKey(publicSlug), JSON.stringify(value));
}

export function clearBookingSession(publicSlug) {
  sessionStorage.removeItem(sessionKey(publicSlug));
}

export function operationKey(session, operation, fingerprint) {
  session.operations ||= {};
  const existing = session.operations[operation];
  if (existing?.fingerprint === fingerprint && existing.key)
    return existing.key;

  const key = newIdempotencyKey(operation);
  session.operations[operation] = { fingerprint, key };
  return key;
}

function sessionKey(publicSlug) {
  return `wildleaf-booking:${publicSlug.toLowerCase()}`;
}
