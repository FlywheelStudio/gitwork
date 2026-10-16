import { Card } from "@/components/kit";
import { VerifyLink } from "./verify-link";

export default function VerifyPage() {
  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        <h1 className="mb-6 text-xl font-semibold">Sign in</h1>
        <VerifyLink />
      </Card>
    </main>
  );
}
