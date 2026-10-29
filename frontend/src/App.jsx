import { useCallback, useEffect, useState } from "react";
import AuthScreen from "./components/AuthScreen";
import Dashboard from "./components/Dashboard";
import { currentSession, signOut } from "./lib/auth";

export default function App() {
  const [session, setSession] = useState(undefined); // undefined = still checking

  const refreshSession = useCallback(() => currentSession().then(setSession), []);
  useEffect(() => { refreshSession(); }, [refreshSession]);

  const leave = useCallback(() => { signOut(); setSession(null); }, []);

  if (session === undefined) return <p className="boot">Loading…</p>;
  if (!session) return <AuthScreen onSignedIn={refreshSession} />;
  return <Dashboard email={session.email} onSignOut={leave} onExpired={leave} />;
}
