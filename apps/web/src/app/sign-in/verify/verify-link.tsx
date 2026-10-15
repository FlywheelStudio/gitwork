"use client";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button, ErrorText } from "@/components/ui";
import { authClient } from "@/lib/auth-client";

/**
 * Opened from the sign-in email. The code is in the URL fragment, which never reaches the server.
 * Nothing happens until the person clicks: email link scanners load pages but do not click.
 */
export function VerifyLink() {
  const router = useRouter();
  const [link, setLink] = useState<{ email: string; code: string } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.hash.slice(1));
    const email = params.get("email");
    const code = params.get("code");
    // Reading the fragment is a one-time sync from the browser URL into state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (email && code) setLink({ email, code });
    else setError("This sign-in link is incomplete. Request a new code.");
  }, []);

  async function continueSignIn() {
    if (!link) return;
    setBusy(true);
    const { error } = await authClient.signIn.emailOtp({ email: link.email, otp: link.code });
    setBusy(false);
    if (error) return setError("This link has expired or was already used. Request a new code.");
    history.replaceState(null, "", window.location.pathname);
    router.push("/");
    router.refresh();
  }

  return (
    <div className="space-y-4">
      {link && (
        <Button onClick={continueSignIn} disabled={busy} className="w-full">
          Continue as {link.email}
        </Button>
      )}
      <ErrorText>{error}</ErrorText>
      {error && (
        <a href="/sign-in" className="text-sm underline">
          Back to sign in
        </a>
      )}
    </div>
  );
}
