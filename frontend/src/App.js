import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Login from './components/Login';
import Register from './components/Register';
import Home from './components/Home';
import BlogDetail from './components/BlogDetail';
import BlogForm from './components/BlogForm';
import MyPosts from './components/MyPosts';
import './App.css';

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/home" element = {<Home />} />
        <Route path="/blog/:id" element={<BlogDetail/>} />
        <Route path="/Post" element = {<BlogForm/>}/>
        <Route path="/MyPosts" element = {<MyPosts/>}/>
      </Routes>
    </Router>
  );
}

export default App;