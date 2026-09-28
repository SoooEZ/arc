/**
 * Server limits restated for the browser (backend `Limits`), so that fields
 * refuse what the server would reject before a save or a preview does. Keep
 * the values in step with the backend constants they name.
 */

/** ExpressionParser reads at most this many tokens from one expression. */
export const MAX_EXPRESSION_TOKENS = 256;
/** Significant digits a number may carry (Limits.MAX_NUMBER_PRECISION). */
export const MAX_NUMBER_PRECISION = 100;
/** Decimal places a number may carry, either way (Limits.MAX_NUMBER_SCALE). */
export const MAX_NUMBER_SCALE = 100;
