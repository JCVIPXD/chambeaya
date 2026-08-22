import { describe, expect, it, vi } from 'vitest';

import { MarketplaceShiftEvents } from '../src/modules/marketplace/marketplace.events.js';

describe('marketplace shift events', () => {
  it('publishes updates only to active subscribers', () => {
    const events = new MarketplaceShiftEvents();
    const listener = vi.fn();
    const unsubscribe = events.subscribe(listener);

    events.publish();
    unsubscribe();
    events.publish();

    expect(listener).toHaveBeenCalledOnce();
    expect(events.subscriberCount).toBe(0);
  });
});
