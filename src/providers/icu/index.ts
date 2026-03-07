import { Provider } from '../../shared/types.js';
import { IcuProvider } from './provider.js';

export function createProvider(): Provider | null {
  if (process.env.GLMCP_ICU_ENABLED === 'false') return null;
  return new IcuProvider();
}
