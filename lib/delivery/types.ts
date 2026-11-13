export type QuoteRequest = {
  orderCode: string;
  customerName: string;
  phone?: string;
  dropoffAddress: string;
  dropoffSuburb?: string;
  dropoffPostcode?: string;
  dropoffNotes?: string;
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
