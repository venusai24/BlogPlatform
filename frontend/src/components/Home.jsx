import React, { useState } from "react";
import NavBar from "./NavBar";
import "./styles.css";
import "bootstrap/dist/css/bootstrap.min.css";
import { useNavigate } from "react-router-dom";

function Home() {
  const [blogs, setBlogs] = useState([]);

  const handleSearchResults = (results) => {
    setBlogs(results);
  };

  const navigate = useNavigate();

  return (
    <div>
      {/* Pass handleSearchResults to NavBar */}
      <NavBar onSearchResults={handleSearchResults} />
      <main className="p-6">
        {/* Conditionally render based on search results */}
        {blogs.length > 0 ? (
          <div className="mt-6">
            {blogs.map((blog) => (
              <div
                key={blog._id}
                className="border rounded-md p-4 mb-4 cursor-pointer hover:shadow-lg"
                onClick={() => navigate(`/blog/${blog._id}`)} // Navigate to BlogDetails
              >
                <h2 className="font-bold text-lg">{blog.title}</h2>
                <p className="text-gray-600">by {blog.author}</p>
              </div>
            ))}
          </div>
        ) : (
          <div>
            <h1 className="text-2xl font-bold mb-4">Welcome to IntelliBlog</h1>
            <p className="text-gray-600 mt-2">
              Explore articles and posts on various topics. Express your thoughts with posts.
            </p>
          </div>
        )}
      </main>
    </div>
  );
}

export default Home;
