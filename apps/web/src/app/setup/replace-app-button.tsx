"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, ErrorText } from "@/components/kit";
import { api } from "@/lib/api";

export function ReplaceAppButton() {
  const router = useRouter();
  const [error, setError] = useState("");
  return (
    <div className="space-y-2">
      <Button
        variant="secondary"
        onClick={async () => {
          try {
            await api("DELETE", "/setup/github");
            router.refresh();
          } catch (err) {
            setError((err as Error).message);
          }
        }}
      >
        Forget the stored App and start over
      </Button>
      <ErrorText>{error}</ErrorText>
    </div>
  );
}
