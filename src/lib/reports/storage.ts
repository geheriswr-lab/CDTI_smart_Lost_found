// Bucket names — must match 0016_storage_buckets.sql.
export const PUBLIC_BUCKET = "item-images-public";
export const PRIVATE_BUCKET = "verification-private";

/** Seconds a signed URL for a private image stays valid (owner/staff view only). */
export const PRIVATE_URL_TTL_SECONDS = 60;
