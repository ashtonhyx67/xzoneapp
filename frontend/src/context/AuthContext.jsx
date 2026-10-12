import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { api } from "../api.js";
import {
  getDeviceAccount,
  rememberDeviceAccount,
  setDeviceHasPin,
  setDeviceHasFaceId,
} from "../lib/device.js";

const AuthContext = createContext(null);

// The token lives in sessionStorage, not localStorage: closing the app (or the
// tab) ends the session, which is what makes the PIN screen the way back in.
const TOKEN_KEY = "token";

function readToken() {
  try {
    // Anything left in localStorage is from before sessions were made
    // per-launch; move it out so an old install doesn't stay signed in forever.
    localStorage.removeItem(TOKEN_KEY);
    return sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

// A Face ID credential belongs to the device that made it, not to the account,
// so the account having one says nothing about whether *this* device does. The
// device flag is only set where it is earned — enrolling here, or signing in
// with it here — and the server is only trusted to switch it off: an account
// with no credentials at all certainly has none on this device.
function faceIdOnDevice(accountHasFaceId) {
  return accountHasFaceId ? undefined : false;
}

export function AuthProvider({ children }) {
  const [token, setToken] = useState(readToken);
  const [user, setUser] = useState(null);
  const [faceIdEnabled, setFaceIdEnabledState] = useState(false);
  const [permissions, setPermissions] = useState([]);
  const [group, setGroup] = useState(null);
  const [isOwner, setIsOwner] = useState(false);
  const [pinSet, setPinSetState] = useState(false);
  const [loading, setLoading] = useState(() => Boolean(readToken()));

  const signOut = useCallback(() => {
    try {
      sessionStorage.removeItem(TOKEN_KEY);
    } catch {
      /* nothing to clear */
    }
    setToken(null);
    setUser(null);
    setFaceIdEnabledState(false);
    setPermissions([]);
    setGroup(null);
    setIsOwner(false);
    setPinSetState(false);
  }, []);

  // Keep the device's record of "does this account have a PIN" in step with
  // the server, so the next launch opens on the right screen.
  const setPinSet = useCallback((value) => {
    setPinSetState(Boolean(value));
    setDeviceHasPin(Boolean(value));
  }, []);

  // The same for Face ID, so the PIN screen can offer it on the next launch.
  const setFaceIdEnabled = useCallback((value) => {
    setFaceIdEnabledState(Boolean(value));
    setDeviceHasFaceId(Boolean(value));
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
        setFaceIdEnabledState(Boolean(data.faceIdEnabled));
        setPermissions(data.permissions || []);
        setGroup(data.group || null);
        setIsOwner(Boolean(data.isOwner));
        setPinSetState(Boolean(data.pinSet));
        rememberDeviceAccount({
          email: data.user.email,
          name: data.user.name,
          hasPin: Boolean(data.pinSet),
          hasFaceId: faceIdOnDevice(data.faceIdEnabled),
        });
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
    try {
      sessionStorage.setItem(TOKEN_KEY, newToken);
      // A different sign-in gets its own chance to be asked about a PIN.
      sessionStorage.removeItem("pinPromptSkipped");
    } catch {
      // Storage is unavailable (private mode); the session still works until
      // the page is reloaded.
    }
    setToken(newToken);
    setUser(newUser);
    setFaceIdEnabledState(Boolean(options.faceIdEnabled));
    setPermissions(options.permissions || []);
    setGroup(options.group || null);
    setIsOwner(Boolean(options.isOwner));
    setPinSetState(Boolean(options.pinSet));
    rememberDeviceAccount({
      email: newUser?.email,
      name: newUser?.name,
      hasPin: Boolean(options.pinSet),
      hasFaceId: options.usedFaceId ? true : faceIdOnDevice(options.faceIdEnabled),
    });
  }, []);

  // What a group is allowed to do is decided on the server and travels as a
  // list of names, so the app asks "can I?" instead of "which group am I?".
  const can = useCallback(
    (permission) => permissions.includes(permission),
    [permissions]
  );

  const value = useMemo(
    () => ({
      token,
      user,
      faceIdEnabled,
      setFaceIdEnabled,
      permissions,
      can,
      group,
      isOwner,
      pinSet,
      setPinSet,
      loading,
      signIn,
      signOut,
      deviceAccount: getDeviceAccount(),
    }),
    [
      token,
      user,
      faceIdEnabled,
      setFaceIdEnabled,
      permissions,
      can,
      group,
      isOwner,
      pinSet,
      setPinSet,
      loading,
      signIn,
      signOut,
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
