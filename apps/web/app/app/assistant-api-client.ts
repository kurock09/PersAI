import {
  type AssistantDraftUpdateRequest,
  ContractsApiError,
  type AssistantLifecycleState,
  getAssistant as getAssistantContract,
  patchAssistantDraft as patchAssistantDraftContract,
  postAssistantCreate as postAssistantCreateContract
} from "@persai/contracts";

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

export async function getAssistant(token: string): Promise<AssistantLifecycleState | null> {
  try {
    const response = await getAssistantContract({
      headers: getAuthHeaders(token)
    });

    if (response.status === 404) {
      return null;
    }

    if (response.status !== 200) {
      throw new Error("Unexpected non-success response for GET /assistant.");
    }

    return response.data.assistant;
  } catch (error) {
    throw new Error(toErrorMessage(error));
  }
}

export async function postAssistantCreate(token: string): Promise<AssistantLifecycleState> {
  try {
    const response = await postAssistantCreateContract({
      headers: getAuthHeaders(token)
    });

    if (response.status !== 200) {
      throw new Error("Unexpected non-success response for POST /assistant.");
    }

    return response.data.assistant;
  } catch (error) {
    throw new Error(toErrorMessage(error));
  }
}

export async function patchAssistantDraft(
  token: string,
  payload: AssistantDraftUpdateRequest
): Promise<AssistantLifecycleState> {
  try {
    const response = await patchAssistantDraftContract(payload, {
      headers: getAuthHeaders(token)
    });

    if (response.status !== 200) {
      throw new Error("Unexpected non-success response for PATCH /assistant/draft.");
    }

    return response.data.assistant;
  } catch (error) {
    throw new Error(toErrorMessage(error));
  }
}
