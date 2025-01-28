import React, { useState, useEffect } from "react";
import NavBar from "./NavBar";
import "./styles.css";
import "bootstrap/dist/css/bootstrap.min.css";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { Card, CardContent } from "./ui/Card";
import { motion } from "framer-motion";

function Home() {
  const [blogs, setBlogs] = useState([]); 
  const [searchResults, setSearchResults] = useState([]); 
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    const fetchBlogs = async () => {
      try {
        const response = await axios.get("http://localhost:5000/blogs/");
        if (response.status === 200) {
          setBlogs(response.data || []); 
        } else {
          setError("Failed to fetch blogs.");
        }
      } catch (err) {
        console.error("Error fetching blogs:", err);
        setError("Failed to fetch blogs. Please try again later.");
      } finally {
        setLoading(false);
      }
    };
  
    fetchBlogs();
  }, []);
  

  const handleSearchResults = (results) => {
    setSearchResults(results || []); 
  };

  const handlePostClick = (id) => {
    navigate(`/blog/${id}`);
  };

  if (loading) return <p className="text-center text-gray-500">Loading...</p>;
  if (error) return <p className="text-center text-red-500">{error}</p>;

  return (
    <div>
      <NavBar onSearchResults={handleSearchResults} />
      <main className="p-6">
        {searchResults.length > 0 ? (
          <div className="mt-6">
            <h2 className="text-xl font-bold text-gray-800 mb-4">
              Search Results
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {searchResults.map((blog) => (
                <Card
                  key={blog._id}
                  className="shadow-lg rounded-2xl overflow-hidden bg-white hover:shadow-xl cursor-pointer"
                  onClick={() => handlePostClick(blog._id)}
                >
                  <CardContent className="p-4">
                    <h2 className="text-xl font-semibold text-gray-800 mb-2">
                      {blog.title}
                    </h2>
                    <p className="text-gray-600 text-sm line-clamp-3">
                      {blog.summary}
                    </p>
                    <p className="text-gray-500 text-xs mt-2">
                      by {blog.author}
                    </p>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        ) : (
          <div>
            <h1 className="text-2xl font-bold mb-4">Welcome to IntelliBlog</h1>
            <p className="text-gray-600 mt-2">
              Explore articles and posts on various topics. Express your
              thoughts with posts.
            </p>
            <div className="mt-6">
              <h2 className="text-xl font-bold text-gray-800 mb-4">
                Recent Blogs
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mt-6">
  {blogs.map((blog) => (
    <motion.div
      key={blog._id}
      className="cursor-pointer border rounded-md p-4 mb-4 shadow-lg hover:shadow-xl bg-white"
      onClick={() => navigate(`/blog/${blog._id}`)}
      whileHover={{
        scale: 1.03,
        boxShadow: "0px 10px 20px rgba(0, 0, 0, 0.2)",
        transition: { duration: 0.3 },
      }}
      whileTap={{ scale: 0.97 }}
    >
      <h2 className="font-bold text-lg">{blog.title}</h2>
      <p className="text-gray-600">by {blog.author}</p>
      <p className="text-gray-500 mt-2 line-clamp-3">{blog.summary}</p>
    </motion.div>
  ))}
</div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

export default Home;
