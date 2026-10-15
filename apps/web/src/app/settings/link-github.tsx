"use client";
import { useState } from "react";
import { Button, ErrorText } from "@/components/ui";
import { authClient } from "@/lib/auth-client";

export function LinkGitHubButton() {
  const [error, setError] = useState("");
  return (
    <div className="space-y-2">
      <Button
        onClick={async () => {
          const { error } = await authClient.linkSocial({ provider: "github", callbackURL: "/settings" });
          if (error) setError(error.message ?? "Could not start GitHub linking.");
        }}
      >
        Link GitHub account
      </Button>
      <ErrorText>{error}</ErrorText>
    </div>
  );
}
