import { useState } from "react";
import Brand from "./Brand";
import { confirmSignUp, resendCode, signIn, signUp } from "../lib/auth";
import { getConfig } from "../lib/config";

const MESSAGES = {
  NotAuthorizedException: "Wrong email or password.",
  UserNotFoundException: "Wrong email or password.",
  UsernameExistsException: "An account with this email already exists. Sign in instead.",
  InvalidPasswordException: "Use at least 10 characters with an upper case letter, a lower case letter and a number.",
  InvalidParameterException: "Use at least 10 characters with an upper case letter, a lower case letter and a number.",
  CodeMismatchException: "That code is not right. Check your email and try again.",
  ExpiredCodeException: "That code has expired. Send a new one.",
  LimitExceededException: "Too many attempts. Wait a few minutes and try again.",
};
const explain = (error) => MESSAGES[error.code] || error.message || "Something went wrong. Try again.";

const TITLES = {
  signin: "Sign in",
  signup: "Create account",
  confirm: "Confirm your email",
  newPassword: "Choose your password",
};

export default function AuthScreen({ onSignedIn }) {
  const allowSignup = Boolean(getConfig().allowSignup);
  const [mode, setMode] = useState("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [challenge, setChallenge] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  const go = (next) => { setMode(next); setError(""); setInfo(""); };

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setInfo("");
    try {
      const address = email.trim();
      if (mode === "signin") {
        const result = await signIn(address, password);
        if (result.status === "newPassword") {
          setChallenge(result);
          setPassword("");
          go("newPassword");
        } else onSignedIn();
      } else if (mode === "newPassword") {
        await challenge.setPassword(password);
        onSignedIn();
      } else if (mode === "signup") {
        await signUp(address, password);
        go("confirm");
        setInfo(`We sent a 6-digit code to ${address}.`);
      } else {
        await confirmSignUp(address, code.trim());
        await signIn(address, password);
        onSignedIn();
      }
    } catch (failure) {
      if (failure.code === "UserNotConfirmedException") {
        go("confirm");
        setInfo("Confirm your email first. Enter the code we sent you, or send a new one.");
      } else setError(explain(failure));
    } finally {
      setBusy(false);
    }
  }

  async function sendNewCode() {
    setError("");
    try {
      await resendCode(email.trim());
      setInfo("A new code is on its way.");
    } catch (failure) {
      setError(explain(failure));
    }
  }

  return (
    <main className="auth">
      <div className="auth-intro">
        <Brand />
        <h1>Photograph a receipt. See where the money went.</h1>
        <p>
          Upload a photo and the store, date, total and category are read for you.
          Your receipts are visible only to your account.
        </p>
      </div>

      <form className="panel auth-form" onSubmit={submit}>
        <h2>{TITLES[mode]}</h2>

        {mode !== "newPassword" && (
          <label>
            Email
            <input
              type="email" required autoComplete="username" value={email}
              onChange={(e) => setEmail(e.target.value)} disabled={mode === "confirm"}
            />
          </label>
        )}

        {mode === "confirm" ? (
          <label>
            Confirmation code
            <input
              inputMode="numeric" required autoComplete="one-time-code" value={code}
              onChange={(e) => setCode(e.target.value)}
            />
          </label>
        ) : (
          <label>
            {mode === "newPassword" ? "New password" : "Password"}
            <input
              type="password" required value={password} onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === "signin" ? "current-password" : "new-password"}
              minLength={mode === "signin" ? undefined : 10}
            />
          </label>
        )}

        {info && <p className="note" role="status">{info}</p>}
        {error && <p className="error" role="alert">{error}</p>}

        <button className="primary" disabled={busy}>
          {busy ? "Please wait…" : { signin: "Sign in", signup: "Create account", confirm: "Confirm email", newPassword: "Save password" }[mode]}
        </button>

        <div className="auth-links">
          {mode === "confirm" && <button type="button" className="link" onClick={sendNewCode}>Send a new code</button>}
          {mode === "signin" && allowSignup && <button type="button" className="link" onClick={() => go("signup")}>Create an account</button>}
          {(mode === "signup" || mode === "confirm") && <button type="button" className="link" onClick={() => go("signin")}>Back to sign in</button>}
        </div>
      </form>
    </main>
  );
}
