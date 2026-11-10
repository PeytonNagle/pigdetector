// Health check until the API routes land. Importing schemas.mjs compiles every bundled schema.
import './lib/schemas.mjs';

export const handler = async () => ({ ok: true });
