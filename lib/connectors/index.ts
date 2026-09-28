import "server-only";

import { quickbooksAdapter } from "./quickbooks/adapter";
import type { OAuthAdapter } from "./oauth";
import type { ConnectorProvider } from "./registry";

/**
 * Provider adapters, by id.
 *
 * A provider with a registry entry but no adapter is one the interface can
 * describe and not yet complete — which is the honest state for anything marked
 * `planned`, and better than hiding it. `adapterFor` returning undefined is
 * therefore a normal answer, not an error, and the routes turn it into "not
 * ready yet" rather than a 500.
 */
const ADAPTERS: Partial<Record<ConnectorProvider, OAuthAdapter>> = {
  quickbooks: quickbooksAdapter,
};

export function adapterFor(
  provider: ConnectorProvider
): OAuthAdapter | undefined {
  return ADAPTERS[provider];
}

export * from "./registry";
export { ConnectorError } from "./oauth";
