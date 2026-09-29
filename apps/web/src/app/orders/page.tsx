import type { Metadata } from "next";
import { OrdersPage } from "@/components/account/account-pages";

export const metadata: Metadata = {
  title: "Orders | TradeKaro",
  description: "Review executed paper trades in your TradeKaro account.",
};

export default function OrdersRoute() {
  return <OrdersPage />;
}
