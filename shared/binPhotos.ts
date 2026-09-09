export const MAX_BIN_PHOTO_BYTES = 500_000;

export function isBinPhoto(value: unknown): value is string {
  return typeof value === "string"
    && value.length <= Math.ceil(MAX_BIN_PHOTO_BYTES / 3) * 4 + 40
    && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value);
}
