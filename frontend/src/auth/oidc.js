// Sign-in against Amazon Cognito managed login with the OpenID Connect authorization code flow and PKCE
// (oidc-client-ts). Only used when REACT_APP_AUTH_PROVIDER=cognito; the values come from build arguments.
//
// The tokens live in sessionStorage (cleared when the tab closes, not shared between tabs). The API
// verifies the access token; nothing here trusts it. There is no silent renewal: the access token lasts an
// hour, after which getAccessToken() returns null and the user signs in again.
import { UserManager, WebStorageStateStore } from 'oidc-client-ts';
import { jwtDecode } from 'jwt-decode';

const settings = () => ({
  region: process.env.REACT_APP_COGNITO_REGION,
  userPoolId: process.env.REACT_APP_COGNITO_USER_POOL_ID,
  clientId: process.env.REACT_APP_COGNITO_CLIENT_ID,
  domain: process.env.REACT_APP_COGNITO_DOMAIN,
});

const authority = ({ region, userPoolId }) => `https://cognito-idp.${region}.amazonaws.com/${userPoolId}`;

let manager = null;
function getManager() {
  if (!manager) {
    const config = settings();
    manager = new UserManager({
      authority: authority(config),
      client_id: config.clientId,
      redirect_uri: `${window.location.origin}/callback`,
      post_logout_redirect_uri: `${window.location.origin}/login`,
      response_type: 'code',
      scope: 'openid profile',
      userStore: new WebStorageStateStore({ store: window.sessionStorage }),
    });
  }
  return manager;
}

export function login() {
  return getManager().signinRedirect();
}

export function handleCallback() {
  return getManager().signinRedirectCallback();
}

// Cognito ends its own session at /logout, which oidc-client-ts does not know about.
export async function logout() {
  const config = settings();
  await getManager().removeUser();
  const logoutUri = encodeURIComponent(`${window.location.origin}/login`);
  window.location.assign(`${config.domain}/logout?client_id=${config.clientId}&logout_uri=${logoutUri}`);
}

// Synchronous on purpose: request code reads the token while building headers. Reads the user that
// oidc-client-ts stored; an expired token counts as signed out.
function storedUser() {
  const config = settings();
  try {
    const raw = window.sessionStorage.getItem(`oidc.user:${authority(config)}:${config.clientId}`);
    if (!raw) return null;
    const user = JSON.parse(raw);
    if (!user.access_token || (user.expires_at && user.expires_at * 1000 <= Date.now())) return null;
    return user;
  } catch (err) {
    return null;
  }
}

export function getAccessToken() {
  const user = storedUser();
  return user ? user.access_token : null;
}

// Cognito access tokens carry the sign-in name in the `username` claim.
export function getUsername() {
  const token = getAccessToken();
  if (!token) return null;
  try {
    return jwtDecode(token).username || null;
  } catch (err) {
    return null;
  }
}
