export type QuoteRequest = {
  orderCode: string;
  customerName: string;
  phone?: string;
  dropoffAddress: string;
  dropoffSuburb?: string;
  dropoffPostcode?: string;
  dropoffNotes?: string;
  /** Geocoded drop-off, when the customer has shared or entered coordinates. */
  dropoffLat?: number | null;
  dropoffLng?: number | null;
  orderValueCents: number;
  pickupReadyAt?: string;
};

export type ProviderQuote = {
  provider: string;
  quoteId: string;
  feeCents: number;
  etaMinutes: number;
  expiresAt: string;
  live: boolean;
  /** Road distance used for our own-fleet pricing and ATO trip estimates. */
  distanceKm?: number;
  fallbackReason?: string;
  raw?: unknown;
};

export type DispatchRequest = {
  quoteId: string;
  orderCode: string;
  customerName: string;
  phone?: string;
  dropoffAddress: string;
  dropoffSuburb?: string;
  dropoffPostcode?: string;
  dropoffNotes?: string;
  dropoffLat?: number | null;
  dropoffLng?: number | null;
  manifest: { name: string; quantity: number }[];
};

export type DispatchResult = {
  provider: string;
  deliveryId: string;
  status: string;
  trackingUrl?: string;
  courierName?: string;
  courierPhone?: string;
  etaMinutes?: number;
  /** Set by our own fleet: the approved driver who accepted the job. */
  driverId?: number;
  raw?: unknown;
};

export type ProviderStatus = {
  status: string;
  trackingUrl?: string;
  courierName?: string;
  courierPhone?: string;
  etaMinutes?: number;
  raw?: unknown;
};

export interface DeliveryProvider {
  name: string;
  live: boolean;
  quote(request: QuoteRequest): Promise<ProviderQuote>;
  dispatch(request: DispatchRequest): Promise<DispatchResult>;
  status(deliveryId: string): Promise<ProviderStatus>;
}
