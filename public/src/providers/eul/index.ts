import { Provider } from '../../shared/types.js';
import { EulProvider } from './provider.js';

export function createProvider(): Provider | null {
  if (process.env.GLMCP_EUL_ENABLED === 'false') return null;
  return new EulProvider();
}
