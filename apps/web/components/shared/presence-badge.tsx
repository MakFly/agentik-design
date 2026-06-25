import { Wifi, WifiOff } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export function PresenceBadge({
  status,
}: {
  status: "online" | "offline" | string;
}) {
  const online = status === "online";
  return (
    <Badge variant={online ? "online" : "offline"}>
      {online ? <Wifi /> : <WifiOff />}
      {status}
    </Badge>
  );
}
