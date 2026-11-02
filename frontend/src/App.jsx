import { useCallback, useEffect, useState } from "react";
import AuthScreen from "./components/AuthScreen";
import Dashboard from "./components/Dashboard";
import ThemeToggle from "./components/ThemeToggle";
import { currentSession, signOut } from "./lib/auth";
import { initTheme } from "./lib/theme";

export default function App() {
  const [session, setSession] = useState(undefined); // undefined = still checking

  useEffect(() => initTheme(), []); // the saved theme, and "auto" follows the system

  const refreshSession = useCallback(() => currentSession().then(setSession), []);
  useEffect(() => { refreshSession(); }, [refreshSession]);

  const leave = useCallback(() => { signOut(); setSession(null); }, []);

  if (session === undefined) return <p className="boot">Loading…</p>;
  if (!session) {
    return (
      <>
        <div className="theme-corner"><ThemeToggle /></div>
        <AuthScreen onSignedIn={refreshSession} />
      </>
    );
  }
  return <Dashboard email={session.email} onSignOut={leave} onExpired={leave} />;
}
