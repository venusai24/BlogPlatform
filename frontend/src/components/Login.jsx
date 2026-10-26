import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import axios from 'axios';
import './Auth.css';
import { jwtDecode } from 'jwt-decode';
import { isCognito } from '../auth/session';
import { login } from '../auth/oidc';


function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const handleLogin = async () => {
    try {
      const response = await axios.post(`${process.env.REACT_APP_API_URL || 'http://localhost:5000'}/auth/login`, {
        username,
        password,
      });

      console.log(response.data); 

      if (response.status === 200) {
        localStorage.setItem('token', response.data.token); 
        const decodedToken = jwtDecode(response.data.token);
        const usernameFromToken = decodedToken.username; // Extract username
        localStorage.setItem("username", usernameFromToken);
        navigate('/home'); // Redirect to Home Page
      }
    } catch (err) {
      console.error('Login failed:', err);
      setError('Invalid username or password');
    }
  };

  if (isCognito()) {
    return (
      <div className="auth-container">
        <h2>Login</h2>
        <button onClick={() => login()}>Sign in with BlogPlatform</button>
      </div>
    );
  }

  return (
    <div className="auth-container">
      <h2>Login</h2>
      {error && <p className="error">{error}</p>}
      <input
        type="text"
        placeholder="Username"
        value={username}
        onChange={(e) => setUsername(e.target.value)}
      />
      <input
        type="password"
        placeholder="Password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      <button onClick={handleLogin}>Login</button>
      <p>
        Don't have an account? <Link to="/register">Register here</Link>
      </p>
    </div>
  );
}

export default Login;