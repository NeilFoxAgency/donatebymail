export interface DonationDraft<Device, Charity> {
  devices: Device[];
  selectedCharity: Charity | null;
  step: number;
}

export function serializeDonationDraft<Device, Charity>(
  draft: DonationDraft<Device, Charity>,
): string {
  return JSON.stringify(draft);
}

export function parseDonationDraft<Device, Charity>(
  value: string,
): DonationDraft<Device, Charity> {
  return JSON.parse(value) as DonationDraft<Device, Charity>;
}
