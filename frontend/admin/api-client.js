const configuredBaseUrl = String(
  globalThis.WILDLEAF_ADMIN_CONFIG?.apiBaseUrl || "",
)
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

export async function authorizedRequest(path, options = {}) {
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(
    () => controller.abort(),
    options.timeoutMs || 20000,
  );
  const headers = new Headers(options.headers || {});
  headers.set("Accept", "application/json");

  try {
    const token = await options.getAccessToken?.();
    if (!token) {
      throw new ApiError("Please sign in to continue.", {
        code: "AUTHENTICATION_REQUIRED",
        status: 401,
      });
    }
    headers.set("Authorization", `Bearer ${token}`);

    if (options.body !== undefined)
      headers.set("Content-Type", "application/json");
    if (options.idempotencyKey) {
      headers.set("Idempotency-Key", options.idempotencyKey);
    }

    const response = await fetch(`${configuredBaseUrl}${path}`, {
      method: options.method || "GET",
      headers,
      body:
        options.body === undefined ? undefined : JSON.stringify(options.body),
      cache: "no-store",
      credentials: "omit",
      signal: controller.signal,
    });

    let data;
    try {
      data = await response.json();
    } catch {
      throw new ApiError("Wildleaf returned an unreadable response.", {
        status: response.status,
      });
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
      throw new ApiError("The request took too long. Please try again.", {
        code: "REQUEST_TIMEOUT",
      });
    }
    if (error instanceof ApiError) throw error;
    throw new ApiError(
      "Wildleaf could not be reached. Check your connection.",
      {
        code: "NETWORK_ERROR",
      },
    );
  } finally {
    globalThis.clearTimeout(timeout);
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
