import type { Metadata } from "next";
import { PortfolioPage } from "@/components/account/account-pages";

export const metadata: Metadata = {
  title: "Portfolio | TradeKaro",
  description: "Review your TradeKaro holdings, cash, and INR portfolio performance.",
};

export default function PortfolioRoute() {
  return <PortfolioPage />;
}
