import type { Metadata } from "next";
import { LeaderboardPage } from "@/components/account/account-pages";

export const metadata: Metadata = {
  title: "Leaderboard | TradeKaro",
  description: "Compare your INR portfolio performance with TradeKaro traders.",
};

export default function LeaderboardRoute() {
  return <LeaderboardPage />;
}
