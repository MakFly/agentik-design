"use client";

import { useState } from "react";
import type { CredentialType } from "@agentik/workflow-schema";
import { useCredentials } from "./api";
import { CredentialPicker } from "./credential-picker";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type AuthKind = "none" | CredentialType;

interface Props {
  team: string;
  value?: string;
  onChange: (id: string) => void;
}

/** Auth selector for the HTTP node: none, header auth, or Google OAuth2. */
export function ApiAuthPicker({ team, value, onChange }: Props) {
  const { data } = useCredentials(team);
  const current = data?.items.find((c) => c.id === value);
  const [selectedKind, setSelectedKind] = useState<AuthKind | null>(null);
  const kind = selectedKind ?? current?.type ?? "none";

  return (
    <div className="flex flex-col gap-2">
      <Select
        value={kind}
        onValueChange={(k) => {
          setSelectedKind(k as AuthKind);
          if (k === "none") onChange("");
        }}
      >
        <SelectTrigger className="h-8 text-sm">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="none">No auth</SelectItem>
          <SelectItem value="httpHeaderAuth">Header auth</SelectItem>
          <SelectItem value="googleOAuth2">Google OAuth2</SelectItem>
        </SelectContent>
      </Select>
      {kind !== "none" && (
        <CredentialPicker
          team={team}
          type={kind}
          value={value}
          onChange={onChange}
        />
      )}
    </div>
  );
}
