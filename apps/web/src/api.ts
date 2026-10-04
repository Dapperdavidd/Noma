export type User = {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  phone: string | null;
  role: "user" | "agent" | "admin";
  is_verified: boolean;
  has_password: boolean;
};
export type Property = {
  id: string;
  slug: string;
  title: string;
  price: number;
  listing_type: string;
  property_type: string;
  rental_period: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  size_sqm: number | null;
  city: string;
  state: string;
  area: string | null;
  cover_image: string | null;
  is_verified: boolean;
  status: string;
  created_at: string;
  description?: string;
  address?: string;
  images?: {
    id?: string;
    url: string;
    public_id?: string | null;
    upload_id?: string | null;
  }[];
  amenities?: string[];
  amenity_ids?: string[];
  agent?: {
    id: string;
    first_name: string;
    last_name: string;
    agency_name: string | null;
    verification_status: string;
  };
  state_id?: string;
  city_id?: string;
  area_id?: string;
};
export type Location = {
  id: string;
  name: string;
  cities: { id: string; name: string; areas: { id: string; name: string }[] }[];
};
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`/api/v1${path}`, {
    credentials: "include",
    ...options,
    headers: { "Content-Type": "application/json", ...options?.headers },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new ApiError(
      body.error || "Something went wrong. Please try again.",
      response.status,
    );
  }
  if (response.status === 204 || response.headers.get("content-length") === "0")
    return undefined as T;
  const text = await response.text();
  return text ? (JSON.parse(text) as T) : (undefined as T);
}
export const money = (price: number) =>
  new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: "NGN",
    maximumFractionDigits: 0,
  }).format(price);
