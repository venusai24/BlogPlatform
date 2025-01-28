import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import axios from 'axios';
import NavBar from './NavBar';
import { useNavigate } from "react-router-dom";



function BlogDetail() {
  const navigate = useNavigate();
  const { id } = useParams(); 
  const [blog, setBlog] = useState(null);
  const [blogs, setBlogs] = useState([]);

  const handleSearchResults = (results) => {
    setBlogs(results); 
  };

  useEffect(() => {
    
    const fetchBlog = async () => {
      try {
        const response = await axios.get(`http://localhost:5000/blogs/${id}`);
        setBlog(response.data.blog);
      } catch (error) {
        console.log(id);
        console.error('Error fetching blog details:', error);
      }
    };

    fetchBlog();
  }, [id]);

  if (!blog) {
    return <div><NavBar onSearchResults={handleSearchResults}/><div>Loading...</div></div>;
  }

 
  return (
    <div>
      <NavBar onSearchResults={handleSearchResults}/>
      <main className="p-6">
      {blogs.length > 0 ? (<div className="mt-6">
        {blogs.map((blog) => (
            <div
            key={blog._id}
            className="border rounded-md p-4 mb-4 cursor-pointer hover:shadow-lg"
            onClick={() => navigate(`/blog/${blog._id}`)} 
            >
            <h2 className="font-bold text-lg">{blog.title}</h2>
            <p className="text-gray-600">by {blog.author}</p>
            </div>
        ))}
        </div>) : (<div className="p-6">
          <h1 className="text-2xl font-bold">{blog.title}</h1>
          <p className="text-gray-600 mt-2">by {blog.author}</p>
          <div className="mt-4">{blog.content}</div>
        </div>)}
      </main>
    </div>
  );
}

export default BlogDetail;

