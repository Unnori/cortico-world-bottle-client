import { INITIAL_FONT_CATALOG, writingFont } from './font-catalog.ts';

/** Public R2 default; personal uploads remain local and take precedence. */
export const DEFAULT_MY_FONT = writingFont(INITIAL_FONT_CATALOG);
