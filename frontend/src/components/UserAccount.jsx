import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import NavBar from "./NavBar";
import { Card, CardContent } from "./ui/Card";
import { motion } from "framer-motion";

function UserAccount() {
  const [user, setUser] = useState(null);
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    const fetchUserData = async () => {
      try {
        const token = localStorage.getItem("token");
        if (!token) {
          navigate("/login");
          return;
        }

        // Fetch User Details
        const userRes = await axios.get("http://localhost:5000/auth/me", {
          headers: { Authorization: `Bearer ${token}` }
        });
        setUser(userRes.data);

        // Fetch User's Posts
        const postsRes = await axios.get(`http://localhost:5000/blogs?author=${userRes.data.username}`);
        setPosts(postsRes.data);
      } catch (err) {
        console.error("Failed to load user account details", err);
        setError("Failed to load account details. Please try logging in again.");
      } finally {
        setLoading(false);
      }
    };

    fetchUserData();
  }, [navigate]);

  if (loading) return <div><NavBar /><p className="text-center mt-8">Loading account details...</p></div>;
  if (error) return <div><NavBar /><p className="text-center mt-8 text-red-500">{error}</p></div>;

  return (
    <div className="bg-gray-50 min-h-screen">
      <NavBar />
      <div className="max-w-4xl mx-auto p-6 mt-8">
        {/* User Profile Card */}
        <motion.div 
          className="bg-white rounded-2xl shadow-lg p-8 mb-8"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <div className="flex items-center gap-6">
            <div className="w-24 h-24 bg-blue-500 rounded-full flex items-center justify-center text-4xl text-white font-bold">
              {user?.username?.charAt(0).toUpperCase()}
            </div>
            <div>
              <h1 className="text-3xl font-bold text-gray-800">{user?.username}</h1>
              <p className="text-gray-500 mt-1">Member since {new Date().toLocaleDateString()}</p>
            </div>
          </div>
        </motion.div>

        {/* User's Posts Section */}
        <h2 className="text-2xl font-bold text-gray-800 mb-6">My Published Posts ({posts.length})</h2>
        
        {posts.length === 0 ? (
          <p className="text-gray-500 text-center py-8 bg-white rounded-lg shadow">You haven't published any posts yet.</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {posts.map((post) => (
              <motion.div
                key={post._id}
                className="cursor-pointer"
                whileHover={{ scale: 1.02 }}
                onClick={() => navigate(`/blog/${post._id}`)}
              >
                <Card className="h-full hover:shadow-xl transition-shadow bg-white rounded-xl border border-gray-100">
                  <CardContent className="p-6">
                    <h3 className="text-xl font-bold text-gray-800 mb-2 line-clamp-2">{post.title}</h3>
                    <p className="text-gray-600 text-sm mb-4 line-clamp-3">{post.summary || post.content}</p>
                    <div className="flex justify-between items-center text-sm text-gray-400">
                      <span>{post.likes || 0} Likes</span>
                      <span>{post.comments?.length || 0} Comments</span>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default UserAccount;
