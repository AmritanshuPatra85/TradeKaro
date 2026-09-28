declare module "breezeconnect" {
  export class BreezeConnect {
    constructor(opts: { appKey: string });
    generateSession(appSecret: string, apiSession: string): Promise<unknown>;
    getCustomerDetails(apiSession: string): Promise<unknown>;
    wsConnect(): void;
    wsDisconnect(): void;
    onTicks: (ticks: unknown) => void;
    subscribeFeeds(opts: Record<string, unknown>): Promise<unknown>;
    unsubscribeFeeds(opts: Record<string, unknown>): Promise<unknown>;
    getFunds(): Promise<unknown>;
    getHistoricalData(opts: Record<string, unknown>): Promise<unknown>;
    getNames(opts: Record<string, unknown>): Promise<unknown>;
    [key: string]: unknown;
  }
}
