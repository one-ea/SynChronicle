import { createContext, useContext, useState, type PropsWithChildren } from "react";

export interface SessionUser {
  id: string;
  username: string;
  role: "user" | "admin";
}

interface SessionState {
  user: SessionUser | null;
  authenticated: boolean;
  establish(user: SessionUser): void;
  restore(): void;
  clear(): void;
}

const SessionContext = createContext<SessionState | null>(null);

export function SessionProvider({ children }: PropsWithChildren) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [authenticated, setAuthenticated] = useState(false);

  return (
    <SessionContext.Provider value={{
      user,
      authenticated,
      establish(nextUser) {
        setUser(nextUser);
        setAuthenticated(true);
      },
      restore() {
        setAuthenticated(true);
      },
      clear() {
        setUser(null);
        setAuthenticated(false);
      },
    }}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSession(): SessionState {
  const session = useContext(SessionContext);
  if (!session) throw new Error("useSession must be used inside SessionProvider");
  return session;
}
