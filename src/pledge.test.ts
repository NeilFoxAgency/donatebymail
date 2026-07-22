import { describe, expect, it } from 'vitest';
import { getPledgeWidgetConfig, parsePledgeMessage, pledgeSelectionReducer } from './pledge';

const UUID_A = 'ec0b21fc-2671-431e-8a81-783b7a9626c9';
const UUID_B = '3685b542-61d5-45da-9580-162dca725966';

function message(origin: string, payload: unknown) {
  return { origin, data: typeof payload === 'string' ? payload : JSON.stringify(payload) } as Pick<MessageEvent, 'origin' | 'data'>;
}

describe('Pledge organization search integration', () => {
  it('loads the production widget with the configured public partner key', () => {
    expect(getPledgeWidgetConfig('partner-123')).toEqual({
      partnerKey: 'partner-123',
      scriptUrl: 'https://www.pledge.to/embed/widget.js',
      allowedOrigin: 'https://www.pledge.to',
      multipleOrganizations: false,
    });
  });

  it('selecting a nonprofit updates the form state', () => {
    const action = parsePledgeMessage(message('https://www.pledge.to', {
      action: 'updateEvent',
      data: { beneficiary_type: 'Organization', beneficiary_uuid: UUID_A, organization_name: 'Example Charity' },
    }));
    expect(action?.type).toBe('selected');
    expect(pledgeSelectionReducer(null, action!)).toMatchObject({ pledgeId: UUID_A, name: 'Example Charity' });
  });

  it('removing a nonprofit clears the form state', () => {
    const action = parsePledgeMessage(message('https://www.pledge.to', { action: 'removeEvent' }));
    expect(pledgeSelectionReducer({ pledgeId: UUID_A, name: 'Example Charity' }, action!)).toBeNull();
  });

  it('changing a nonprofit replaces the previous selection', () => {
    const action = parsePledgeMessage(message('https://www.pledge.to', {
      action: 'updateEvent',
      data: { beneficiary_type: 'Organization', beneficiary_uuid: UUID_B, name: 'Second Charity' },
    }));
    const result = pledgeSelectionReducer({ pledgeId: UUID_A, name: 'First Charity' }, action!);
    expect(result).toMatchObject({ pledgeId: UUID_B, name: 'Second Charity' });
  });

  it('ignores messages from an unapproved origin', () => {
    expect(parsePledgeMessage(message('https://attacker.example', {
      action: 'updateEvent',
      data: { beneficiary_uuid: UUID_A },
    }))).toBeNull();
  });

  it('ignores malformed and unrelated messages without throwing', () => {
    expect(parsePledgeMessage(message('https://www.pledge.to', '{not json'))).toBeNull();
    expect(parsePledgeMessage(message('https://www.pledge.to', { action: 'otherEvent' }))).toBeNull();
    expect(parsePledgeMessage(message('https://www.pledge.to', {
      action: 'updateEvent',
      data: { beneficiary_uuid: 'not-a-uuid' },
    }))).toBeNull();
  });
});
