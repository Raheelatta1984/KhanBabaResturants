export type VariantView = {
  id: number;
  label: string;
  sizeMl: number | null;
  priceCents: number;
  isDefault: boolean;
};

export type RatingView = { avg: number; count: number };

export type ItemView = {
  id: number;
  slug: string;
  name: string;
  tagline: string | null;
  description: string | null;
  categorySlug: string;
  categoryName: string;
  image: string;
  gallery: string[];
  youtubeId: string | null;
  ingredients: string[];
  allergens: string[];
  spiceLevels: string[];
  prepMinutes: number;
  isVeg: boolean;
  isFeatured: boolean;
  isNew: boolean;
  available: boolean;
  variants: VariantView[];
  rating: RatingView;
};

export type ReviewView = {
  id: number;
  customerName: string;
  rating: number;
  comment: string | null;
  createdAt: string;
};

export type CategoryView = {
  id: number;
  slug: string;
  name: string;
  description: string | null;
  count: number;
};
