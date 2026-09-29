import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { LoginForm } from "@/components/auth/LoginForm";
import { AUTH_COOKIE, authPassword, safeNextPath, verifySession } from "@/lib/server/auth";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "登入｜Livelyrics",
  robots: { index: false, follow: false },
};

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

/** The password gate's sign-in page (LIVELYRICS_PASSWORD). Without a password, or when already signed in, it moves on. */
export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const params = await searchParams;
  const next = safeNextPath(first(params.next));
  const password = authPassword();
  if (!password) redirect(next);
  if (await verifySession(password, (await cookies()).get(AUTH_COOKIE)?.value)) redirect(next);
  return <LoginForm next={next} initialError={first(params.error) ? "密碼不正確，請再試一次。" : null} />;
}
