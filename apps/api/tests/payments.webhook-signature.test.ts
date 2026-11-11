import { describe, expect, it } from 'vitest';

import { InvalidSignatureError, signPayload, verifySignature } from '../src/modules/payments/webhook-signature.js';

const SECRET = 'x'.repeat(40);

describe('webhook-signature', () => {
  it('accepts a signature it just generated for the same body', () => {
    const body = Buffer.from(JSON.stringify({ hello: 'world' }));
    const header = signPayload(SECRET, body, 1_700_000_000_000);
    expect(() => verifySignature(SECRET, body, header, 1_700_000_000_000)).not.toThrow();
  });

  it('rejects a missing signature header', () => {
    const body = Buffer.from('{}');
    expect(() => verifySignature(SECRET, body, undefined)).toThrow(InvalidSignatureError);
  });

  it('rejects a malformed signature header', () => {
    const body = Buffer.from('{}');
    expect(() => verifySignature(SECRET, body, 'not-a-valid-header')).toThrow(InvalidSignatureError);
  });

  it('rejects a body altered after signing (tampering)', () => {
    const body = Buffer.from(JSON.stringify({ amountCents: 100 }));
    const header = signPayload(SECRET, body, 1_700_000_000_000);
    const tampered = Buffer.from(JSON.stringify({ amountCents: 999999 }));
    expect(() => verifySignature(SECRET, tampered, header, 1_700_000_000_000)).toThrow(InvalidSignatureError);
  });

  it('rejects a signature made with a different secret', () => {
    const body = Buffer.from('{}');
    const header = signPayload('y'.repeat(40), body, 1_700_000_000_000);
    expect(() => verifySignature(SECRET, body, header, 1_700_000_000_000)).toThrow(InvalidSignatureError);
  });

  it('rejects a timestamp outside the 5-minute tolerance (clock skew / replay)', () => {
    const body = Buffer.from('{}');
    const signedAt = 1_700_000_000_000;
    const header = signPayload(SECRET, body, signedAt);
    const sixMinutesLater = signedAt + 6 * 60 * 1000;
    expect(() => verifySignature(SECRET, body, header, sixMinutesLater)).toThrow(InvalidSignatureError);
  });

  it('accepts a timestamp right at the edge of the tolerance (under 5 minutes)', () => {
    const body = Buffer.from('{}');
    const signedAt = 1_700_000_000_000;
    const header = signPayload(SECRET, body, signedAt);
    const fourMinutesLater = signedAt + 4 * 60 * 1000 + 59_000;
    expect(() => verifySignature(SECRET, body, header, fourMinutesLater)).not.toThrow();
  });

  it('rejects a non-numeric timestamp', () => {
    const body = Buffer.from('{}');
    expect(() => verifySignature(SECRET, body, 't=not-a-number,v1=abcd')).toThrow(InvalidSignatureError);
  });

  it('rejects a digest that is not valid hex', () => {
    const body = Buffer.from('{}');
    expect(() => verifySignature(SECRET, body, `t=${Date.now()},v1=not-hex-zz`)).toThrow(InvalidSignatureError);
  });
});
