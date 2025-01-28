import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent } from "./ui/Card";
import { motion } from "framer-motion";
import axios from "axios";

const AuthorPosts = ({ username }) => {
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const navigate = useNavigate();
  useEffect(() => {
    const fetchPosts = async () => {
      try {
        const response = await axios.post(
          "http://localhost:5000/blogs/retrieve/author",
          { author: username }
        );

        if (response.status === 400) {
          setError("No blogs found for the given author.");
          setPosts([]);
        } else {
          setPosts(response.data.blogs);
        }
        
      } catch (err) {
        setError("Failed to fetch posts. Please try again later.");
      } finally {
        setLoading(false);
      }
    };

    fetchPosts();
  }, [username]);

  

  if (loading) return <p className="text-center text-gray-500">Loading...</p>;
  if (error) return <p className="text-center text-red-500">{error}</p>;

  return (
    <div className="p-4 max-w-4xl mx-auto">
      <motion.div
        className="text-center mb-8"
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
      >
        <h1 className="text-3xl font-bold text-gray-800">{username}</h1>
        <p className="text-lg text-gray-600 mt-2">{posts.length} Posts</p>
      </motion.div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {posts.map((post) => (
          <motion.div
            key={post._id}
            className="cursor-pointer"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            whileHover={{ scale: 1.03 }}
            transition={{ duration: 0.3 }}
          >
            <Card
              className="shadow-lg rounded-2xl overflow-hidden bg-white hover:shadow-xl"
              onClick={() => {
                console.log("C")
                navigate(`/blog/${post._id}`);
            }}
            >
              <CardContent className="p-4">
                <h2 className="text-xl font-semibold text-gray-800 mb-2">
                  {post.title}
                </h2>
                <p className="text-gray-600 text-sm line-clamp-3">
                  {post.summary}
                </p>
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </div>

      {posts.length === 0 && (
        <p className="text-center text-gray-500 mt-4">No posts available.</p>
      )}
    </div>
  );
};

export default AuthorPosts;
