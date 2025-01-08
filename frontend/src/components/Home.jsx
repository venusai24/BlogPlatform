import React from 'react';
import NavBar from './NavBar';
import './styles.css';
import 'bootstrap/dist/css/bootstrap.min.css';

function Home() {
  return (
    <div>
      <NavBar />
      <main className="p-6">
        <h1 className="text-2xl font-bold">Welcome to IntelliBlog</h1>
        <p className="text-gray-600 mt-2">
          Explore articles and posts on various topics. Express your thoughts with posts
        </p>
      </main>
    </div>
  );
}

export default Home;
