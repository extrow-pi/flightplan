import { createAuthClient } from "better-auth/react";
import { useQuery } from "@tanstack/react-query";

// Talks to /api/auth/* on the same origin (proxied to the API in dev)
export const authClient = createAuthClient();

export const { useSession, signIn, signUp, signOut } = authClient;

/** Which sign-in methods the API has configured. */
export function useAuthConfig() {
  return useQuery({
    queryKey: ["auth-config"],
    queryFn: async (): Promise<{ google: boolean }> => {
      const res = await fetch("/api/auth-config");
      if (!res.ok) throw new Error("Could not load sign-in options");
      return res.json();
    },
    staleTime: Infinity,
  });
}

/** Only allow same-site relative redirects, e.g. "/dashboard". */
export function safeRedirect(target: string | null, fallback = "/dashboard") {
  return target && target.startsWith("/") && !target.startsWith("//") ? target : fallback;
}
