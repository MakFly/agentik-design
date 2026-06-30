import type { Metadata } from "next";
import { ChannelsScreen } from "@/features/channels/channels-screen";

export const metadata: Metadata = { title: "Channels" };

export default async function ChannelsPage({ params }: { params: Promise<{ team: string }> }) {
  const { team } = await params;
  return <ChannelsScreen team={team} />;
}
