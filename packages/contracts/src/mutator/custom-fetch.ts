export class ContractsApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly payload: unknown
  ) {
    super(message);
    this.name = "ContractsApiError";
  }
}

interface ApiErrorEnvelope {
  error?: {
    message?: string;
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
    const messageFromEnvelope =
      typeof payload === "object" && payload !== null
        ? ((payload as ApiErrorEnvelope).error?.message ?? null)
        : null;

    throw new ContractsApiError(
      messageFromEnvelope ?? `Request failed with status ${response.status}.`,
      response.status,
      payload
    );
  }

  return {
    data: payload,
    status: response.status,
    headers: response.headers
  } as TData;
}
