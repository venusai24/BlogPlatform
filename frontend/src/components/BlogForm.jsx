import React, { useState } from "react";
import axios from "axios";

function BlogForm() {
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");

  const handleSubmit = async (e) => {
    e.preventDefault();
    const username = localStorage.getItem("username"); 
    console.log(username);

    try {
      const response = await axios.post("http://localhost:5000/blogs", {
        title,
        content,
        author: username,
      });

      if (response.status === 201) {
        alert("Blog posted successfully!");
        setTitle("");
        setContent("");
      }
    } catch (error) {
      console.error("Error posting blog:", error);
    }
  };

  return (
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
  );
}

export default BlogForm;
