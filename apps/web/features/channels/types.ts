export type ChannelProvider = "telegram";
export type ChannelConnectionStatus = "setup" | "active" | "disabled" | "error";
export type ChannelTransport = "polling" | "webhook";

export interface ChannelConnection {
  id: string;
  teamId: string;
  provider: ChannelProvider;
  label: string;
  status: ChannelConnectionStatus;
  transport: ChannelTransport;
  webhookSecret: string;
  webhookPath: string;
  pairingCode: string;
  botUsername: string | null;
  botTokenConfigured: boolean;
  identityCount: number;
  createdAt: string;
  updatedAt: string;
}
