export type MarketplaceShiftListener = () => void;

export class MarketplaceShiftEvents {
  private readonly listeners = new Set<MarketplaceShiftListener>();

  subscribe(listener: MarketplaceShiftListener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  publish() {
    for (const listener of this.listeners) listener();
  }

  get subscriberCount() {
    return this.listeners.size;
  }
}

export const marketplaceShiftEvents = new MarketplaceShiftEvents();
