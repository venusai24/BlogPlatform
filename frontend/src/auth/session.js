// One place for "who is signed in and what token do I send", for both sign-in providers:
//   app      the API issued the token at /auth/login; it and the username are kept in localStorage
//   cognito  Cognito issued it; oidc.js reads it from the OIDC user store
// Chosen by the REACT_APP_AUTH_PROVIDER build argument.
import * as oidc from './oidc';

export const isCognito = () => process.env.REACT_APP_AUTH_PROVIDER === 'cognito';

export function getToken() {
  return isCognito() ? oidc.getAccessToken() : localStorage.getItem('token');
}

export function getUsername() {
  return isCognito() ? oidc.getUsername() : localStorage.getItem('username');
}

export function isLoggedIn() {
  return Boolean(getToken() && getUsername());
}

// Forget the app-mode session locally (the Cognito session is ended by signOut).
export function clearSession() {
  localStorage.removeItem('token');
  localStorage.removeItem('username');
}

export function signOut() {
  if (isCognito()) {
    return oidc.logout();
  }
  clearSession();
  return Promise.resolve();
}
