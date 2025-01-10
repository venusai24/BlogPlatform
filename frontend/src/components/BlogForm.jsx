import React, { useState } from "react";
import axios from "axios";
import NavBar from "./NavBar";
import Summary from "./Summary";

function BlogForm() {
  const [activeTab, setActiveTab] = useState("Blog");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [summary, setSummary] = useState("");
  const [blogs, setBlogs] = useState([]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    const username = localStorage.getItem("username");

    try {
      const response = await axios.post("http://localhost:5000/blogs", {
        title,
        content,
        summary,
        author: username,
      });

      if (response.status === 201) {
        alert("Blog and summary posted successfully!");
        setTitle("");
        setContent("");
        setSummary("");
      }
    } catch (error) {
      console.error("Error posting blog:", error);
    }
  };

  const handleSearchResults = (results) => {
    setBlogs(results);
  };


 


  return (
    <div>
      <NavBar onSearchResults={handleSearchResults}/>
      <main className="p-6">
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
    <div className="w-full">
        <div className="flex bg-gray-200 p-2 space-x-2 border-b">
          {["Blog", "Summary"].map((tab) => (
            <div
              key={tab}
              className={`px-4 py-2 rounded-t cursor-pointer ${
                activeTab === tab ? "bg-white shadow" : "bg-gray-300"
              }`}
              onClick={() => setActiveTab(tab)}
            >
              {tab}
            </div>
          ))}
        </div>

        <div className="p-6 border">
          {activeTab === "Blog" && (
            <form onSubmit={handleSubmit} className="p-6 border rounded-md">
              <h2 className="text-xl font-bold mb-4">Create a Blog</h2>
              <input
                type="text"
                placeholder="Title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full p-2 mb-4 border rounded-md"
                required
              />
              <textarea
                placeholder="Content"
                value={content}
                onChange={(e) => setContent(e.target.value)}
                className="w-full p-2 mb-4 border rounded-md"
                rows="6"
                required
              />
              <button
                type="submit"
                className="bg-blue-500 text-white px-4 py-2 rounded-md hover:bg-blue-600"
              >
                Upload
              </button>
            </form>
          )}

          {activeTab === "Summary" && (
            <Summary content={content} title={title} setSummary={setSummary} />
          )}
        </div>
      </div>
  )}
      </main>
    </div>
  );
}

export default BlogForm;
