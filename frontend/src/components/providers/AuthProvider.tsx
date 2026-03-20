"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { fetchMe, apiLogout, type UserOut } from "@/lib/api/backendClient";
import AuthModal from "@/components/auth/AuthModal";
import OnboardingModal from "@/components/auth/OnboardingModal";

type AuthState = {
  user: UserOut | null;
  loading: boolean;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthState>({
  user: null,
  loading: true,
  logout: async () => {},
});

export function useAuth() {
  return useContext(AuthContext);
}

// Auth is not required on these paths
const AUTH_BYPASS = ["/auth/callback"];

export default function AuthProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [user, setUser]       = useState<UserOut | null>(null);
  const [loading, setLoading] = useState(true);

  const loadUser = useCallback(async () => {
    const token = localStorage.getItem("umai_access_token");
    if (!token) { setUser(null); setLoading(false); return; }
    try {
      const me = await fetchMe();
      setUser(me);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load
  useEffect(() => { loadUser(); }, [loadUser]);

  // Re-fetch when tokens change (login / logout / OAuth callback)
  useEffect(() => {
    function onAuthChange() { setLoading(true); loadUser(); }
    window.addEventListener("umai:auth-change", onAuthChange);
    return () => window.removeEventListener("umai:auth-change", onAuthChange);
  }, [loadUser]);

  // Forced logout from token refresh failure (access token 만료 + refresh token 만료)
  useEffect(() => {
    function onLogout() {
      setUser(null);
      setLoading(false);
      // 현재 경로가 auth bypass가 아니면 루트로 리다이렉트 → AuthModal 표시
      if (!AUTH_BYPASS.some((p) => window.location.pathname.startsWith(p))) {
        window.location.replace("/");
      }
    }
    window.addEventListener("umai:logout", onLogout);
    return () => window.removeEventListener("umai:logout", onLogout);
  }, []);

  const logout = useCallback(async () => {
    await apiLogout();
    setUser(null);
  }, []);

  const isAuthBypass  = AUTH_BYPASS.some((p) => pathname?.startsWith(p));
  const needsAuth     = !loading && user === null && !isAuthBypass;
  const needsOnboard  = !loading && user !== null && !user.is_onboarded && !isAuthBypass;

  return (
    <AuthContext.Provider value={{ user, loading, logout }}>
      {children}
      {needsAuth && <AuthModal />}
      {needsOnboard && (
        <OnboardingModal
          user={user}
          onComplete={(updated) => setUser(updated)}
        />
      )}
    </AuthContext.Provider>
  );
}
