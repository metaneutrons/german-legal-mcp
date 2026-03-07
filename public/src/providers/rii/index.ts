import { Provider } from '../../shared/types.js';
import { RiiProvider } from './provider.js';

export function createProvider(): Provider | null {
  if (process.env.GLMCP_RII_ENABLED === 'false') return null;
  return new RiiProvider();
}
