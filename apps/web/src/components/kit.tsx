/**
 * App-level form pieces on top of shadcn/ui (src/components/ui). Pages import from here; the
 * shadcn files stay as the CLI writes them.
 */
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Button as UiButton } from "@/components/ui/button";
import { Card as UiCard } from "@/components/ui/card";
import { Label as UiLabel } from "@/components/ui/label";

export { Input } from "@/components/ui/input";
export { Textarea } from "@/components/ui/textarea";

const VARIANT = { primary: "default", secondary: "outline", danger: "destructive", ghost: "ghost" } as const;

export function Button({
  variant = "primary",
  ...props
}: Omit<ComponentProps<typeof UiButton>, "variant"> & { variant?: keyof typeof VARIANT }) {
  return <UiButton variant={VARIANT[variant]} {...props} />;
}

/** A native select: works without JavaScript and with Playwright's selectOption. */
export function Select({ className, ...props }: ComponentProps<"select">) {
  return (
    <select
      className={cn(
        "h-8 rounded-lg border border-input bg-transparent px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30",
        className,
      )}
      {...props}
    />
  );
}

export function Label({ children, htmlFor, className }: { children: ReactNode; htmlFor: string; className?: string }) {
  return (
    <UiLabel htmlFor={htmlFor} className={cn("mb-1.5", className)}>
      {children}
    </UiLabel>
  );
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <UiCard className={cn("px-6 py-6", className)}>{children}</UiCard>;
}

export function ErrorText({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <p role="alert" className="text-sm text-destructive">
      {children}
    </p>
  );
}

export const ROLE_LABEL: Record<string, string> = {
  owner: "Owner",
  admin: "Admin",
  member: "Member",
  read_only: "Read Only",
};
