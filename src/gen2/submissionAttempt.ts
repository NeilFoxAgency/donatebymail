import type { DonationSubmission } from "../submission";

export type SubmissionIntent = Omit<DonationSubmission, "id" | "clientSubmissionKey" | "createdAt">;
export type SubmissionAttempt = {
  fingerprint: string;
  key: string;
  id: string;
  createdAt: string;
  marketingConsentAt?: string;
};

export const submissionIntentFingerprint = (intent: SubmissionIntent): string => JSON.stringify(intent);

export function resolveSubmissionAttempt(
  current: SubmissionAttempt | null,
  fingerprint: string,
  marketingConsent: boolean,
  createUuid: () => string,
  createDonationId: () => string,
  now: () => string,
): SubmissionAttempt {
  if (current?.fingerprint === fingerprint) return current;
  const createdAt = now();
  return { fingerprint, key: createUuid(), id: createDonationId(), createdAt,
    marketingConsentAt: marketingConsent ? createdAt : undefined };
}
