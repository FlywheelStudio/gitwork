import { APP_NAME } from "@gitwork/core";
import { Suspense } from "react";
import { Card } from "@/components/ui";
import { SignInForm } from "./sign-in-form";

export default function SignInPage() {
  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        <h1 className="mb-6 text-xl font-semibold">Sign in to {APP_NAME}</h1>
        <Suspense>
          <SignInForm />
        </Suspense>
      </Card>
    </main>
  );
}
