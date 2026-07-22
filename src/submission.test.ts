import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildAdministratorNotification, validateDonationSubmission, type DonationSubmission } from './submission';

const submission: DonationSubmission = {
  id: 'DBM-20260722-ABCDE',
  createdAt: '2026-07-22T03:00:00.000Z',
  donor: {
    name: 'Sample Donor',
    email: 'donor@example.com',
    address1: '123 Main Street',
    address2: '',
    city: 'Kissimmee',
    state: 'FL',
    zip: '34741',
  },
  shippingMethod: 'label',
  devices: [{
    id: 'phone-1',
    brand: 'Apple',
    model: 'iPhone 13',
    age: '2-3 years',
    condition: 'Good',
    storage: '128 GB',
    powersOn: true,
    unlocked: true,
  }],
  charity: {
    pledgeId: 'ec0b21fc-2671-431e-8a81-783b7a9626c9',
    name: 'Example Charity',
    ein: '12-3456789',
    city: 'Orlando',
    state: 'FL',
    country: 'US',
  },
};

describe('donation submission and administrator notification', () => {
  it('rejects a form submission without a charity selection', () => {
    const { charity: _charity, ...withoutCharity } = submission;
    expect(validateDonationSubmission(withoutCharity)).toBe(false);
  });

  it('requires a Pledge UUID rather than a manually edited nonprofit name', () => {
    expect(validateDonationSubmission({ ...submission, charity: { name: 'Typed charity', pledgeId: '' } })).toBe(false);
  });

  it('includes the selected nonprofit name and Pledge UUID in submitted data', () => {
    expect(validateDonationSubmission(submission)).toBe(true);
    expect(submission.charity).toMatchObject({
      name: 'Example Charity',
      pledgeId: 'ec0b21fc-2671-431e-8a81-783b7a9626c9',
    });
  });

  it('includes selected charity details in the administrator notification', () => {
    const notification = buildAdministratorNotification(submission);
    expect(notification).toContain('Selected Charity');
    expect(notification).toContain('Name: Example Charity');
    expect(notification).toContain('Pledge ID: ec0b21fc-2671-431e-8a81-783b7a9626c9');
    expect(notification).toContain('EIN: 12-3456789');
    expect(notification).toContain('Location: Orlando, FL, US');
    expect(notification).toContain('Sample Donor');
    expect(notification).toContain('iPhone 13');
  });

  it('does not place a secret Pledge API key in frontend source files', () => {
    const frontend = [
      readFileSync('src/App.tsx', 'utf8'),
      readFileSync('src/pledge.ts', 'utf8'),
      readFileSync('donate-phone.html', 'utf8'),
    ].join('\n');
    expect(frontend).not.toContain('PLEDGE_API_KEY');
    expect(frontend).not.toMatch(/Authorization:\s*Bearer/i);
  });
});
