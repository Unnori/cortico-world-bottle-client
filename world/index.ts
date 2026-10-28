/** 包入口：默认导出 `WorldDefinition`，加载器按 `cortico.kind === 'world'` 认它。 */
import { BOTTLE } from './definition.ts';

export default BOTTLE;
export { BOTTLE };
export type { BottleConfigSection } from './config.ts';
