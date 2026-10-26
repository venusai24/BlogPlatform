import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { handleCallback } from '../auth/oidc';

// Where Cognito sends the browser back to (/callback). Exchanges the authorization code for tokens,
// then goes to the home page.
function AuthCallback() {
  const navigate = useNavigate();
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    handleCallback()
      .then(() => { if (!cancelled) navigate('/home', { replace: true }); })
      .catch((err) => {
        console.error('Sign-in failed', err);
        if (!cancelled) setError('Sign-in failed. Please try again.');
      });
    return () => { cancelled = true; };
  }, [navigate]);

  return (
    <div className="auth-container">
      {error ? <p className="error">{error}</p> : <p>Signing you in...</p>}
    </div>
  );
}

export default AuthCallback;
