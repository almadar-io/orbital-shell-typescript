/**
 * Re-export of the renderer-agnostic preview-prep pipeline now owned by
 * `@almadar/runtime/ui`. Kept here for backward compatibility during the POC.
 *
 * @packageDocumentation
 */
export {
  buildMockData,
  adjustSchemaForMockData,
  prepareSchemaForPreview,
  type PreparedPreviewSchema,
} from '../runtime';
