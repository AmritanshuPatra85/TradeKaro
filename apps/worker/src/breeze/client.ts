import { BreezeConnect } from "breezeconnect";
import { getBreezeConfig } from "./config";

let client: BreezeConnect | null = null;

export function getBreezeClient(): BreezeConnect {
  if (!client) {
    const { apiKey } = getBreezeConfig();
    client = new BreezeConnect({ appKey: apiKey });
  }
  return client;
}
