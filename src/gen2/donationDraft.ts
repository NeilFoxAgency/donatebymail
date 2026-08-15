export interface DonationDraft<Device, Charity> {
  devices: Device[];
  selectedCharity: Charity | null;
  step: number;
}

const MAX_DRAFT_BYTES = 100_000;
const MAX_DRAFT_DEVICES = 20;

export function serializeDonationDraft<Device, Charity>(
  draft: DonationDraft<Device, Charity>,
): string {
  return JSON.stringify(draft);
}

export function parseDonationDraft<Device, Charity>(
  value: string,
): DonationDraft<Device, Charity> {
  if (typeof value !== "string" || value.length > MAX_DRAFT_BYTES
    || new TextEncoder().encode(value).byteLength > MAX_DRAFT_BYTES)
    throw new Error("invalid_donation_draft");
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    throw new Error("invalid_donation_draft");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new Error("invalid_donation_draft");
  const candidate = parsed as Record<string, unknown>;
  if (!Array.isArray(candidate.devices) || candidate.devices.length < 1 || candidate.devices.length > MAX_DRAFT_DEVICES
    || !Number.isInteger(candidate.step) || (candidate.step as number) < 1 || (candidate.step as number) > 3)
    throw new Error("invalid_donation_draft");
  if (candidate.selectedCharity !== null && candidate.selectedCharity !== undefined
    && (typeof candidate.selectedCharity !== "object" || Array.isArray(candidate.selectedCharity)))
    throw new Error("invalid_donation_draft");
  return {
    devices: candidate.devices as Device[],
    selectedCharity: (candidate.selectedCharity ?? null) as Charity | null,
    step: candidate.step as number,
  };
}
