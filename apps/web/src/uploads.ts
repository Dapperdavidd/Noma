import { api } from "./api";
type UploadSignature = {
  upload_id: string;
  cloud_name: string;
  api_key: string;
  timestamp: number;
  public_id: string;
  overwrite: boolean;
  upload_preset: string;
  signature: string;
  resource_type: "image" | "video";
};
export type ManagedUpload = {
  upload_id: string;
  public_id: string;
  url: string;
};

async function uploadMedia(
  file: File,
  resourceType: "image" | "video",
): Promise<ManagedUpload> {
  const signature = await api<UploadSignature>("/images/signature", {
    method: "POST",
    body: JSON.stringify({ resource_type: resourceType }),
  });
  const body = new FormData();
  body.set("file", file);
  for (const [key, value] of Object.entries(signature)) {
    if (key !== "cloud_name" && key !== "upload_id" && key !== "resource_type")
      body.set(key, String(value));
  }
  try {
    const response = await fetch(
      `https://api.cloudinary.com/v1_1/${encodeURIComponent(signature.cloud_name)}/${resourceType}/upload`,
      { method: "POST", body },
    );
    const result = await response.json();
    if (!response.ok || !result.secure_url)
      throw new Error("This photo could not be uploaded. Please try again.");
    return await api<ManagedUpload>(
      `/images/uploads/${signature.upload_id}/confirm`,
      { method: "POST" },
    );
  } catch (error) {
    await api(`/images/uploads/${signature.upload_id}`, {
      method: "DELETE",
    }).catch(() => undefined);
    throw error;
  }
}

export async function uploadPhoto(file: File): Promise<ManagedUpload> {
  if (
    !["image/jpeg", "image/png", "image/webp", "image/avif"].includes(file.type)
  )
    throw new Error("Choose a JPEG, PNG, WebP or AVIF photo.");
  if (file.size > 10 * 1024 * 1024)
    throw new Error("Each photo must be smaller than 10 MB.");
  return uploadMedia(file, "image");
}

export async function uploadVideo(file: File): Promise<ManagedUpload> {
  if (!["video/mp4", "video/webm", "video/quicktime"].includes(file.type))
    throw new Error("Choose an MP4, WebM or MOV video.");
  if (file.size > 100 * 1024 * 1024)
    throw new Error("Each video must be smaller than 100 MB.");
  return uploadMedia(file, "video");
}
