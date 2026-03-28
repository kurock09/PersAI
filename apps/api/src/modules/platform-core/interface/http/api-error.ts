import { HttpException } from "@nestjs/common";

export type ApiErrorCategory =
  | "validation"
  | "auth"
  | "forbidden"
  | "conflict"
  | "infra"
  | "unknown";

export type ApiErrorObject = {
  code: string;
  category: ApiErrorCategory;
  message: string;
  details?: Record<string, unknown>;
};

export class ApiErrorHttpException extends HttpException {
  constructor(
    status: number,
    public readonly errorObject: ApiErrorObject
  ) {
    super({ error: errorObject }, status);
  }
}
