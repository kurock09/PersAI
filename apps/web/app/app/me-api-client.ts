export interface WorkspaceSummary {
  id: string;
  name: string;
  locale: string;
  timezone: string;
  status: "active" | "inactive";
  role: "owner" | "member";
}

export interface CurrentMeResponse {
  requestId: string | null;
  me: {
    appUser: {
      id: string;
      clerkUserId: string;
      email: string;
      displayName: string | null;
    };
    onboarding: {
      isComplete: boolean;
      status: "completed" | "pending";
    };
    workspace: WorkspaceSummary | null;
  };
}

export interface OnboardingPayload {
  displayName: string;
  workspaceName: string;
  locale: string;
  timezone: string;
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
  return "http://localhost:3001";
}

async function parseApiError(response: Response): Promise<string> {
  try {
    const json = (await response.json()) as ApiErrorEnvelope;
    if (typeof json.error?.message === "string" && json.error.message.length > 0) {
      return json.error.message;
    }
  } catch {
    return `Request failed with status ${response.status}.`;
  }

  return `Request failed with status ${response.status}.`;
}

async function authorizedRequest<T>(path: string, token: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${getApiBaseUrl()}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {})
    }
  });

  if (!response.ok) {
    throw new Error(await parseApiError(response));
  }

  return (await response.json()) as T;
}

export async function getMe(token: string): Promise<CurrentMeResponse> {
  return authorizedRequest<CurrentMeResponse>("/api/v1/me", token, { method: "GET" });
}

export async function postOnboarding(
  token: string,
  payload: OnboardingPayload
): Promise<CurrentMeResponse> {
  return authorizedRequest<CurrentMeResponse>("/api/v1/me/onboarding", token, {
    method: "POST",
    body: JSON.stringify(payload)
  });
}
