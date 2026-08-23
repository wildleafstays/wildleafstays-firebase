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
        options.rawBody !== undefined
          ? options.rawBody
          : options.body === undefined
            ? undefined
            : JSON.stringify(options.body),
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

export async function sha256File(file) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    await file.arrayBuffer(),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export async function uploadFile(path, file, options = {}) {
  const body = new FormData();
  body.append("file", file, file.name);
  const contentSha256 = await sha256File(file);
  return authorizedRequest(path, {
    method: "POST",
    rawBody: body,
    getAccessToken: options.getAccessToken,
    idempotencyKey: options.idempotencyKey,
    headers: { "X-Content-SHA256": contentSha256 },
    timeoutMs: options.timeoutMs || 120000,
  });
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
