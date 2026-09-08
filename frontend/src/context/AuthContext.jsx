import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { api } from "../api.js";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => localStorage.getItem("token"));
  const [user, setUser] = useState(null);
  const [faceIdEnabled, setFaceIdEnabled] = useState(false);
  const [loading, setLoading] = useState(() => Boolean(localStorage.getItem("token")));

  const signOut = useCallback(() => {
    localStorage.removeItem("token");
    setToken(null);
    setUser(null);
    setFaceIdEnabled(false);
  }, []);

  // Only restore the session on a cold start. Signing in already has the user,
  // so re-fetching it there would be a second round trip for nothing.
  useEffect(() => {
    if (!token || user) {
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    let active = true;

    api
      .me(token, controller.signal)
      .then((data) => {
        if (!active) return;
        setUser(data.user);
        setFaceIdEnabled(Boolean(data.faceIdEnabled));
      })
      .catch((err) => {
        if (!active || err.name === "AbortError") return;
        // Only a rejected token means signed out. A 5xx or a network blip must
        // not throw away a perfectly good session.
        if (err.status === 401) signOut();
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [token, user, signOut]);

  const signIn = useCallback((newToken, newUser, options = {}) => {
    localStorage.setItem("token", newToken);
    setToken(newToken);
    setUser(newUser);
    setFaceIdEnabled(Boolean(options.faceIdEnabled));
  }, []);

  const value = useMemo(
    () => ({ token, user, faceIdEnabled, setFaceIdEnabled, loading, signIn, signOut }),
    [token, user, faceIdEnabled, loading, signIn, signOut]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
