import { api } from "./api";
type UploadSignature = {
  cloud_name: string;
  api_key: string;
  timestamp: number;
  public_id: string;
  overwrite: boolean;
  upload_preset: string;
  signature: string;
};
export async function uploadPhoto(file: File): Promise<string> {
  if (
    !["image/jpeg", "image/png", "image/webp", "image/avif"].includes(file.type)
  )
    throw new Error("Choose a JPEG, PNG, WebP or AVIF photo.");
  if (file.size > 10 * 1024 * 1024)
    throw new Error("Each photo must be smaller than 10 MB.");
  const signature = await api<UploadSignature>("/images/signature", {
    method: "POST",
  });
  const body = new FormData();
  body.set("file", file);
  for (const [key, value] of Object.entries(signature)) {
    if (key !== "cloud_name") body.set(key, String(value));
  }
  const response = await fetch(
    `https://api.cloudinary.com/v1_1/${encodeURIComponent(signature.cloud_name)}/image/upload`,
    { method: "POST", body },
  );
  const result = await response.json();
  if (!response.ok || !result.secure_url)
    throw new Error("This photo could not be uploaded. Please try again.");
  return result.secure_url;
}
