export class ContractsApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly payload: unknown,
    public readonly code?: string
  ) {
    super(message);
    this.name = "ContractsApiError";
  }
}

interface ApiErrorEnvelope {
  error?: {
    message?: string;
    code?: string;
  };
  message?: string;
  code?: string;
}

function extractApiError(payload: unknown): { message: string | null; code: string | null } {
  if (typeof payload !== "object" || payload === null) {
    return { message: null, code: null };
  }

  const envelope = payload as ApiErrorEnvelope;
  return {
    message:
      (typeof envelope.error?.message === "string" ? envelope.error.message : null) ??
      (typeof envelope.message === "string" ? envelope.message : null),
    code:
      (typeof envelope.error?.code === "string" ? envelope.error.code : null) ??
      (typeof envelope.code === "string" ? envelope.code : null)
  };
}

function getApiBaseUrl(): string {
  const fromEnv = process.env.NEXT_PUBLIC_API_BASE_URL;
  if (typeof fromEnv === "string" && fromEnv.trim().length > 0) {
    return fromEnv.trim().replace(/\/$/, "");
  }

  if (typeof window !== "undefined") {
    return "/api/v1";
  }

  return "http://localhost:3001/api/v1";
}

function resolveUrl(url: string): string {
  if (url.startsWith("http://") || url.startsWith("https://")) {
    return url;
  }

  return `${getApiBaseUrl()}${url}`;
}

export async function customFetch<TData>(url: string, options?: RequestInit): Promise<TData> {
  const response = await fetch(resolveUrl(url), options);
  const contentType = response.headers.get("content-type") ?? "";
  const isJson = contentType.includes("application/json");

  const payload = isJson ? await response.json() : await response.text();

  if (!response.ok) {
    const extracted = extractApiError(payload);

    throw new ContractsApiError(
      extracted.message ?? `Request failed with status ${response.status}.`,
      response.status,
      payload,
      extracted.code ?? undefined
    );
  }

  return {
    data: payload,
    status: response.status,
    headers: response.headers
  } as TData;
}
