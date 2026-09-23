import { randomUUID } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";
import { FLOOR_MAP_MAX_BYTES } from "@flightplan/shared";

// Uploaded files live on local disk for now (apps/api/.data/uploads, or UPLOADS_DIR).
// Swap this module for object storage (S3, R2…) before running more than one API server.
const uploadsDir = process.env.UPLOADS_DIR ?? fileURLToPath(new URL("../.data/uploads", import.meta.url));
await mkdir(uploadsDir, { recursive: true });

const types = {
  png: "image/png",
  jpg: "image/jpeg",
  webp: "image/webp",
} as const;
type Ext = keyof typeof types;

const fileNamePattern = /^[0-9a-f-]{36}\.(png|jpg|webp)$/;

/** Identify an image by its first bytes rather than trusting the browser's content type. */
function sniffImage(bytes: Uint8Array): Ext | null {
  const starts = (...sig: number[]) => sig.every((b, i) => bytes[i] === b);
  if (starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "png";
  if (starts(0xff, 0xd8, 0xff)) return "jpg";
  // RIFF....WEBP
  if (starts(0x52, 0x49, 0x46, 0x46) && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) {
    return "webp";
  }
  return null;
}

export class UploadError extends Error {}

/** Validate and store an uploaded floor map image. Returns the stored file name. */
export async function saveImage(file: File): Promise<string> {
  if (file.size === 0) throw new UploadError("That file is empty");
  if (file.size > FLOOR_MAP_MAX_BYTES) {
    throw new UploadError(`Images can be up to ${FLOOR_MAP_MAX_BYTES / 1024 / 1024} MB`);
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const ext = sniffImage(bytes);
  if (!ext) throw new UploadError("Upload a PNG, JPEG or WebP image");

  const name = `${randomUUID()}.${ext}`;
  await writeFile(`${uploadsDir}/${name}`, bytes);
  return name;
}

export async function deleteUpload(name: string) {
  if (!fileNamePattern.test(name)) return;
  await unlink(`${uploadsDir}/${name}`).catch(() => {});
}

export function uploadUrl(name: string | null) {
  return name ? `/api/uploads/${name}` : null;
}

// Public: floor maps are shown on vendor booking pages. File names are random UUIDs.
export const uploadRoutes = new Hono().get("/:file", async (c) => {
  const name = c.req.param("file");
  if (!fileNamePattern.test(name)) return c.notFound();
  const data = await readFile(`${uploadsDir}/${name}`).catch(() => null);
  if (!data) return c.notFound();
  const ext = name.split(".").pop() as Ext;
  return c.body(data, 200, {
    "Content-Type": types[ext],
    "Cache-Control": "public, max-age=31536000, immutable",
    "X-Content-Type-Options": "nosniff",
  });
});
