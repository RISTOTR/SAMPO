import type { ApiResult, OperationErrorDto } from '../../../shared/dtos'

export function unwrapResult<T>(result: ApiResult<T>): T {
  if (result.ok) {
    return result.data
  }

  throw result.error
}

export function errorMessage(error: unknown): string {
  if (isOperationError(error)) {
    return error.message
  }

  return 'Unexpected error.'
}

function isOperationError(error: unknown): error is OperationErrorDto {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    'message' in error &&
    typeof (error as OperationErrorDto).message === 'string'
  )
}
