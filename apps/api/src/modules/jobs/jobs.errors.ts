export type JobErrorCode =
  | 'JOB_POSTING_NOT_FOUND' | 'JOB_APPLICATION_NOT_FOUND' | 'JOB_OFFER_NOT_FOUND' | 'JOB_DOCUMENT_NOT_FOUND'
  | 'INVALID_STATE_TRANSITION' | 'POSTING_NOT_PUBLISHED' | 'POSTING_NOT_OPEN' | 'POSTING_FILLED'
  | 'POSTING_NOT_EDITABLE' | 'POSTING_HAS_APPLICATIONS' | 'ALREADY_APPLIED' | 'OFFER_NOT_PENDING'
  | 'TOO_MANY_PENDING_UPLOADS' | 'VACANCIES_BELOW_FILLED' | 'INVALID_SALARY_RANGE'
  | 'INVALID_SCREENING_ANSWERS' | 'INVALID_CURSOR' | 'INVALID_INTERVIEW_DATE' | 'INVALID_START_DATE'
  | 'OFFER_DOCUMENT_NOT_AVAILABLE' | 'INVALID_OFFER_DOCUMENT';

/** Error de negocio de puestos fijos con el código HTTP que le corresponde. */
export class JobError extends Error {
  constructor(
    public readonly code: JobErrorCode,
    public readonly statusCode: number,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(code);
  }
}
