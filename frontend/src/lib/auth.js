// Cognito sign-in with SRP: the password itself never leaves the browser.
import {
  AuthenticationDetails,
  CognitoUser,
  CognitoUserAttribute,
  CognitoUserPool,
} from "amazon-cognito-identity-js";
import { getConfig } from "./config";

let pool;
const getPool = () => {
  if (!pool) {
    const { userPoolId, clientId } = getConfig();
    pool = new CognitoUserPool({ UserPoolId: userPoolId, ClientId: clientId });
  }
  return pool;
};

const makeUser = (email) => new CognitoUser({ Username: email, Pool: getPool() });

const asPromise = (run) =>
  new Promise((resolve, reject) => run((error, result) => (error ? reject(error) : resolve(result))));

/** Returns { status: "signedIn" } or { status: "newPassword", setPassword(newPassword) }. */
export function signIn(email, password) {
  const user = makeUser(email);
  const details = new AuthenticationDetails({ Username: email, Password: password });
  return new Promise((resolve, reject) => {
    user.authenticateUser(details, {
      onSuccess: () => resolve({ status: "signedIn" }),
      onFailure: reject,
      // Accounts made with "aws cognito-idp admin-create-user" must pick their own password first.
      newPasswordRequired: () =>
        resolve({
          status: "newPassword",
          setPassword: (newPassword) =>
            new Promise((ok, fail) =>
              user.completeNewPasswordChallenge(newPassword, {}, { onSuccess: () => ok(), onFailure: fail })
            ),
        }),
    });
  });
}

export const signUp = (email, password) =>
  asPromise((done) =>
    getPool().signUp(email, password, [new CognitoUserAttribute({ Name: "email", Value: email })], null, done)
  );

export const confirmSignUp = (email, code) =>
  asPromise((done) => makeUser(email).confirmRegistration(code, true, done));

export const resendCode = (email) => asPromise((done) => makeUser(email).resendConfirmationCode(done));

/** The signed-in user ({ email, token }) or null. Refreshes an expired token automatically. */
export function currentSession() {
  const user = getPool().getCurrentUser();
  if (!user) return Promise.resolve(null);
  return new Promise((resolve) =>
    user.getSession((error, session) => {
      if (error || !session || !session.isValid()) return resolve(null);
      const idToken = session.getIdToken();
      resolve({ email: idToken.payload.email, token: idToken.getJwtToken() });
    })
  );
}

export const signOut = () => getPool().getCurrentUser()?.signOut();
