import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import NavBar from "./NavBar";
import AuthorPosts from "./AuthorPosts";
import { getUsername } from '../auth/session';

const MyPosts = () => {
  const [blogs, setBlogs] = useState([]);
  const username = getUsername(); // Retrieve the signed-in username
  const navigate = useNavigate();

  const handleSearchResults = (results) => {
    setBlogs(results); // Update blogs based on search results
  };

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
          // If no search results, use AuthorPosts with username
          <AuthorPosts username={username} />
        )}
      </main>
    </div>
  );
};

export default MyPosts;
