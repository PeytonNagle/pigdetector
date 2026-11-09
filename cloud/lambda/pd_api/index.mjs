// pd-api Lambda. Health check only for now; API routes arrive with the HTTP API.
import { schemaIds } from './lib/schemas.mjs';

// Loading schemas.mjs compiles every schema, so a successful call proves they were bundled.
export const handler = async () => ({ ok: true, schemas: schemaIds });
