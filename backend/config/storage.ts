import { createClient } from "@supabase/supabase-js";

const MAX_IMAGE_BYTES = 3_500_000;
const STORAGE_REFERENCE_PREFIX = "supabase-storage://";

const supabaseUrl = String(process.env.SUPABASE_URL || "")
  .trim()
  .replace(/\/+$/, "");
const supabaseServerKey = String(
  process.env.SUPABASE_SECRET_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    "",
).trim();
const bucketName = String(
  process.env.SUPABASE_STORAGE_BUCKET || "payment-proofs",
).trim();
const signedUrlTtlSeconds = Math.min(
  Math.max(
    Number(process.env.SUPABASE_STORAGE_SIGNED_URL_TTL || 3600),
    300,
  ),
  86_400,
);

let client: ReturnType<typeof createClient> | null = null;

function hasUsableCloudStorageConfiguration() {
  if (!supabaseUrl || !supabaseServerKey) {
    return false;
  }

  if (/^(?:your[-_ ]|replace[-_ ]?with|put[-_ ]?a[-_ ]?)/i.test(supabaseServerKey)) {
    return false;
  }

  try {
    return new URL(supabaseUrl).protocol === "https:";
  } catch {
    return false;
  }
}

function getClient() {
  if (!hasUsableCloudStorageConfiguration()) {
    throw new Error(
      "Supabase Storage is not configured correctly. Set a valid SUPABASE_URL and SUPABASE_SECRET_KEY.",
    );
  }

  if (!client) {
    client = createClient(
      supabaseUrl,
      supabaseServerKey,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      },
    );
  }

  return client;
}

type ParsedImage = {
  contentType: string;
  extension: "png" | "jpg" | "webp";
  buffer: Buffer;
};

export function parseImageDataUrl(
  value: unknown,
): ParsedImage | null {
  const proof = String(value || "").trim();
  const match = /^data:(image\/(?:png|jpeg|jpg|webp));base64,([A-Za-z0-9+/=\s]+)$/i.exec(
    proof,
  );

  if (!match) {
    return null;
  }

  const contentType = match[1].toLowerCase() === "image/jpg"
    ? "image/jpeg"
    : match[1].toLowerCase();
  const base64 = match[2].replace(/\s+/g, "");
  const buffer = Buffer.from(base64, "base64");

  if (buffer.length === 0 || buffer.length > MAX_IMAGE_BYTES) {
    return null;
  }

  return {
    contentType,
    extension: contentType === "image/png"
      ? "png"
      : contentType === "image/webp"
        ? "webp"
        : "jpg",
    buffer,
  };
}

export function isCloudStorageConfigured() {
  return hasUsableCloudStorageConfiguration();
}

export function imageExtensionForDataUrl(value: unknown) {
  const parsed = parseImageDataUrl(value);

  if (!parsed) {
    throw new Error("The image data is invalid or too large.");
  }

  return parsed.extension;
}

function toStorageReference(path: string) {
  return `${STORAGE_REFERENCE_PREFIX}${bucketName}/${path}`;
}

function parseStorageReference(value: unknown) {
  const reference = String(value || "").trim();

  if (!reference.startsWith(STORAGE_REFERENCE_PREFIX)) {
    return null;
  }

  const remainder = reference.slice(
    STORAGE_REFERENCE_PREFIX.length,
  );
  const separatorIndex = remainder.indexOf("/");

  if (separatorIndex <= 0 || separatorIndex === remainder.length - 1) {
    return null;
  }

  const bucket = remainder.slice(0, separatorIndex);
  const path = remainder.slice(separatorIndex + 1);

  if (bucket !== bucketName || !path || path.includes("..")) {
    return null;
  }

  return { bucket, path };
}

export function isStorageReference(value: unknown) {
  return Boolean(parseStorageReference(value));
}

export async function storeProof(
  dataUrl: string,
  path: string,
) {
  if (!isCloudStorageConfigured()) {
    return dataUrl;
  }

  const parsed = parseImageDataUrl(dataUrl);

  if (!parsed) {
    throw new Error("The image data is invalid or too large.");
  }

  const { error } = await getClient()
    .storage
    .from(bucketName)
    .upload(path, parsed.buffer, {
      cacheControl: "3600",
      contentType: parsed.contentType,
      upsert: false,
    });

  if (error) {
    throw new Error(`Unable to upload proof image: ${error.message}`);
  }

  return toStorageReference(path);
}

export async function signedProofUrl(value: unknown) {
  const rawValue = String(value || "").trim();
  const reference = parseStorageReference(rawValue);

  if (!reference) {
    return rawValue || null;
  }

  const { data, error } = await getClient()
    .storage
    .from(reference.bucket)
    .createSignedUrl(reference.path, signedUrlTtlSeconds);

  if (error || !data?.signedUrl) {
    throw new Error(
      `Unable to create a proof image URL: ${error?.message || "Unknown storage error."}`,
    );
  }

  return data.signedUrl;
}

export async function hydratePaymentProofUrls<
  T extends {
    receipt_proof?: string | null;
    remittance_proof?: string | null;
  },
>(rows: T[]) {
  const signedUrlCache = new Map<string, Promise<string | null>>();

  const resolve = (value: string | null | undefined) => {
    if (!value || !isStorageReference(value)) {
      return Promise.resolve(value ?? null);
    }

    if (!signedUrlCache.has(value)) {
      signedUrlCache.set(value, signedProofUrl(value));
    }

    return signedUrlCache.get(value)!;
  };

  return Promise.all(
    rows.map(async (row) => ({
      ...row,
      receipt_proof: await resolve(row.receipt_proof),
      remittance_proof: await resolve(row.remittance_proof),
    })),
  );
}

export async function deleteStoredProof(value: unknown) {
  const reference = parseStorageReference(value);

  if (!reference || !isCloudStorageConfigured()) {
    return;
  }

  const { error } = await getClient()
    .storage
    .from(reference.bucket)
    .remove([reference.path]);

  if (error) {
    throw new Error(`Unable to remove proof image: ${error.message}`);
  }
}
