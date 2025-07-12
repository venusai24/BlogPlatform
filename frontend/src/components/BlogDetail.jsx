import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import axios from 'axios';
import NavBar from './NavBar';

function BlogDetail() {
  const navigate = useNavigate();
  const { id } = useParams(); 
  const [blog, setBlog] = useState(null);
  const [blogs, setBlogs] = useState([]);
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState('');
  const [editSummary, setEditSummary] = useState('');
  const [editTitle, setEditTitle] = useState('');
  const [editTags, setEditTags] = useState('');

  const handleSearchResults = (results) => {
    setBlogs(results); 
  };

  useEffect(() => {
    const fetchBlog = async () => {
      try {
        const response = await axios.get(`http://localhost:5000/blogs/${id}`);
        const blogData = response.data.blog;
        setBlog(blogData);
        setEditTitle(blogData.title || '');
        setEditContent(blogData.content || '');
        setEditSummary(blogData.summary || '');
        setEditTags(blogData.tags?.join(', ') || '');
      } catch (error) {
        console.error('Error fetching blog details:', error);
      }
    };

    fetchBlog();
  }, [id]);

  const handleSave = async () => {
    try {
      const response = await axios.put(
        `http://localhost:5000/blogs/${id}`,
        {
          title: editTitle,
          content: editContent,
          summary: editSummary,
          tags: editTags.split(',').map(tag => tag.trim()),
        },
        {
          headers: {
            Authorization: `Bearer ${localStorage.getItem('token')}`, // adjust as per your storage
          },
        }
      );
      setBlog(response.data.blog);
      setIsEditing(false);
    } catch (error) {
      console.error('Error updating blog:', error);
    }
  };

  const handleDelete = async () => {
    const confirmDelete = window.confirm('Are you sure you want to delete this blog post?');
    if (!confirmDelete) return;

    try {
      await axios.delete(`http://localhost:5000/blogs/${id}`, {
        headers: {
          Authorization: `Bearer ${localStorage.getItem('token')}`, // adjust token source
        },
      });
      alert('Blog deleted successfully!');
      navigate('/'); // Redirect to home or blogs list
    } catch (error) {
      console.error('Error deleting blog:', error);
    }
  };

  if (!blog) {
    return (
      <div>
        <NavBar onSearchResults={handleSearchResults} />
        <div>Loading...</div>
      </div>
    );
  }

  return (
    <div>
      <NavBar onSearchResults={handleSearchResults} />
      <main className="p-6">
        {blogs.length > 0 ? (
          <div className="mt-6">
            {blogs.map((b) => (
              <div
                key={b._id}
                className="border rounded-md p-4 mb-4 cursor-pointer hover:shadow-lg"
                onClick={() => navigate(`/blog/${b._id}`)} 
              >
                <h2 className="font-bold text-lg">{b.title}</h2>
                <p className="text-gray-600">by {b.author}</p>
              </div>
            ))}
          </div>
        ) : (
          <div className="p-6">
            {isEditing ? (
              <>
                <label className="block font-semibold mt-4">Title</label>
                <input
                  className="w-full p-2 border rounded mt-1"
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                />

                <label className="block font-semibold mt-4">Summary</label>
                <textarea
                  className="w-full p-2 border rounded mt-1"
                  value={editSummary}
                  onChange={(e) => setEditSummary(e.target.value)}
                />

                <label className="block font-semibold mt-4">Content</label>
                <textarea
                  className="w-full p-2 border rounded mt-1"
                  value={editContent}
                  onChange={(e) => setEditContent(e.target.value)}
                />

                <label className="block font-semibold mt-4">Tags (comma-separated)</label>
                <input
                  className="w-full p-2 border rounded mt-1"
                  value={editTags}
                  onChange={(e) => setEditTags(e.target.value)}
                />

                <div className="mt-4">
                  <button
                    onClick={handleSave}
                    className="bg-blue-500 text-white px-4 py-2 rounded mr-2 hover:bg-blue-600"
                  >
                    Save
                  </button>
                  <button
                    onClick={() => setIsEditing(false)}
                    className="bg-gray-300 px-4 py-2 rounded hover:bg-gray-400"
                  >
                    Cancel
                  </button>
                </div>
              </>
            ) : (
              <>
                <h1 className="text-2xl font-bold">{blog.title}</h1>
                <p className="text-gray-600 mt-2">by {blog.author}</p>
                <h2 className="mt-4 font-semibold">Summary</h2>
                <p className="whitespace-pre-wrap">{blog.summary || 'No summary available.'}</p>
                <h2 className="mt-4 font-semibold">Content</h2>
                <p className="whitespace-pre-wrap">{blog.content}</p>

                <div className="mt-6 flex gap-4">
                  <button
                    onClick={() => setIsEditing(true)}
                    className="bg-yellow-500 text-white px-4 py-2 rounded hover:bg-yellow-600"
                  >
                    Edit Blog
                  </button>
                  <button
                    onClick={handleDelete}
                    className="bg-red-500 text-white px-4 py-2 rounded hover:bg-red-600"
                  >
                    Delete Blog
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </main>
    </div>
  );
}

export default BlogDetail;
