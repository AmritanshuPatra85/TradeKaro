import type { Metadata } from "next";
import MarketsPage from "@/components/markets/markets-page";

export const metadata: Metadata = {
  title: "Markets | TradeKaro",
  description: "Follow live NSE and crypto prices on the TradeKaro market terminal.",
};

export default function MarketsRoute() {
  return <MarketsPage />;
}
