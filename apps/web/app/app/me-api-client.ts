import {
  ContractsApiError,
  getMe as getMeContract,
  patchMePreferences as patchMePreferencesContract,
  postMeOnboarding as postMeOnboardingContract,
  type GetMeResponse,
  type OnboardingRequest,
  type UpdateUserPreferencesRequest
} from "@persai/contracts";

export type CurrentMeResponse = GetMeResponse;
export type OnboardingPayload = OnboardingRequest;
export type UserPreferencesPayload = UpdateUserPreferencesRequest;

function getAuthHeaders(token: string): HeadersInit {
  return {
    Authorization: `Bearer ${token}`
  };
}

function toErrorMessage(error: unknown): string {
  if (error instanceof ContractsApiError) {
    return error.message;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "Unknown API request error.";
}

export async function getMe(token: string): Promise<CurrentMeResponse> {
  try {
    const response = await getMeContract({
      headers: getAuthHeaders(token)
    });

    if (response.status !== 200) {
      throw new Error("Unexpected non-success response for GET /me.");
    }

    return response.data;
  } catch (error) {
    throw new Error(toErrorMessage(error));
  }
}

export async function patchMePreferences(
  token: string,
  payload: UserPreferencesPayload
): Promise<CurrentMeResponse> {
  try {
    const response = await patchMePreferencesContract(payload, {
      headers: getAuthHeaders(token)
    });

    if (response.status !== 200) {
      throw new Error("Unexpected non-success response for PATCH /me/preferences.");
    }

    return response.data;
  } catch (error) {
    throw new Error(toErrorMessage(error));
  }
}

export async function postOnboarding(
  token: string,
  payload: OnboardingPayload
): Promise<CurrentMeResponse> {
  try {
    const response = await postMeOnboardingContract(payload, {
      headers: getAuthHeaders(token)
    });

    if (response.status !== 200) {
      throw new Error("Unexpected non-success response for POST /me/onboarding.");
    }

    return response.data;
  } catch (error) {
    throw new Error(toErrorMessage(error));
  }
}
