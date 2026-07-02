import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import axios from 'axios';
import NavBar from './NavBar';
import { useBlog, useAddComment, useLikeBlog, useAddReply } from '../hooks/useBlogs';
import { io } from 'socket.io-client';
import { useQueryClient } from '@tanstack/react-query';

function BlogDetail() {
  const navigate = useNavigate();
  const { id } = useParams(); 
  const { data: blog, isLoading, error } = useBlog(id);
  const addCommentMutation = useAddComment();
  const addReplyMutation = useAddReply();
  const likeBlogMutation = useLikeBlog();
  const queryClient = useQueryClient();
  
  const [blogs, setBlogs] = useState([]);
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState('');
  const [editSummary, setEditSummary] = useState('');
  const [editTitle, setEditTitle] = useState('');
  const [editTags, setEditTags] = useState('');
  const [newComment, setNewComment] = useState('');
  const [replyingTo, setReplyingTo] = useState(null);
  const [replyText, setReplyText] = useState('');
  const [currentUser] = useState(localStorage.getItem('username'));

  // Function to check if current user is the author
  const isAuthor = () => {
    if (!currentUser || !blog) return false;
    return currentUser === blog.author;
  };

  const handleSearchResults = (results) => {
    setBlogs(results); 
  };

  useEffect(() => {
    if (blog) {
      setEditTitle(blog.title || '');
      setEditContent(blog.content || '');
      setEditSummary(blog.summary || '');
      setEditTags(blog.tags?.join(', ') || '');
    }
  }, [blog]);

  useEffect(() => {
    const socket = io('http://localhost:5000');

    socket.on('like_updated', (data) => {
      if (data.blogId === id) {
        queryClient.setQueryData(['blog', id], (old) => {
          if (!old) return old;
          return { ...old, likes: data.likes, likedBy: data.likedBy };
        });
      }
    });

    socket.on('new_comment', (data) => {
      if (data.blogId === id) {
        queryClient.setQueryData(['blog', id], (old) => {
          if (!old) return old;
          return { ...old, comments: data.comments };
        });
      }
    });

    return () => socket.disconnect();
  }, [id, queryClient]);

  const handleSave = async () => {
    try {
      await axios.put(
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
      // Here we might ideally want to invalidate the query, but we'll do a simple reload or update for now.
      window.location.reload(); 
    } catch (error) {
      console.error('Error updating blog:', error);
    }
  };

  const handleLike = () => {
    likeBlogMutation.mutate(id);
  };

  const handleAddComment = (e) => {
    e.preventDefault();
    if (!newComment.trim()) return;

    addCommentMutation.mutate({ id, comment: newComment });
    setNewComment('');
  };

  const handleAddReply = (e, commentId) => {
    e.preventDefault();
    if (!replyText.trim()) return;

    addReplyMutation.mutate({ id, commentId, reply: replyText });
    setReplyText('');
    setReplyingTo(null);
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

  if (isLoading) {
    return (
      <div>
        <NavBar onSearchResults={handleSearchResults} />
        <div className="p-6">Loading...</div>
      </div>
    );
  }

  if (error || !blog) {
    return (
      <div>
        <NavBar onSearchResults={handleSearchResults} />
        <div className="p-6 text-red-500">Error loading blog post.</div>
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

                <div className="mt-8 pt-6 border-t">
                  <div className="flex items-center gap-2 mb-6">
                    <button 
                      onClick={handleLike}
                      disabled={!currentUser || isAuthor()}
                      className={`flex items-center gap-2 px-4 py-2 rounded-full transition-colors ${
                        !currentUser || isAuthor()
                          ? "bg-gray-100 text-gray-400 cursor-not-allowed"
                          : blog.likedBy?.includes(currentUser)
                          ? "bg-pink-500 text-white hover:bg-pink-600"
                          : "bg-pink-100 text-pink-600 hover:bg-pink-200"
                      }`}
                      title={
                        isAuthor() 
                          ? "You cannot like your own post" 
                          : !currentUser 
                          ? "Log in to like this post" 
                          : blog.likedBy?.includes(currentUser) 
                          ? "Unlike this post" 
                          : "Like this post"
                      }
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M3.172 5.172a4 4 0 015.656 0L10 6.343l1.172-1.171a4 4 0 115.656 5.656L10 17.657l-6.828-6.829a4 4 0 010-5.656z" clipRule="evenodd" />
                      </svg>
                      <span className="font-semibold">{blog.likes || 0} Likes</span>
                    </button>
                  </div>

                  <h3 className="text-xl font-bold mb-4">Comments ({blog.comments?.length || 0})</h3>
                  
                  {/* Comment Form */}
                  <form onSubmit={handleAddComment} className="mb-8">
                    <textarea
                      value={newComment}
                      onChange={(e) => setNewComment(e.target.value)}
                      placeholder={currentUser ? "Write a comment..." : "Please log in to comment"}
                      disabled={!currentUser}
                      className="w-full p-3 border rounded-lg focus:ring-2 focus:ring-blue-500 min-h-[100px]"
                    />
                    <button 
                      type="submit"
                      disabled={!currentUser || !newComment.trim()}
                      className="mt-2 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50"
                    >
                      Post Comment
                    </button>
                  </form>

                  {/* Comments List */}
                  <div className="space-y-4">
                    {blog.comments && blog.comments.map((c, idx) => (
                      <div key={c._id || idx} className="bg-gray-50 p-4 rounded-lg">
                        <div className="flex justify-between items-start mb-2">
                          <span className="font-semibold">{c.user}</span>
                          <span className="text-sm text-gray-500">
                            {new Date(c.timestamp).toLocaleDateString()}
                          </span>
                        </div>
                        <p className="text-gray-700">{c.comment}</p>
                        
                        {/* Reply Button */}
                        <div className="mt-2">
                          <button 
                            onClick={() => {
                              setReplyingTo(replyingTo === c._id ? null : c._id);
                              setReplyText('');
                            }}
                            className="text-sm text-blue-500 hover:text-blue-700 font-medium"
                          >
                            Reply
                          </button>
                        </div>

                        {/* Reply Input Form */}
                        {replyingTo === c._id && (
                          <form onSubmit={(e) => handleAddReply(e, c._id)} className="mt-3 ml-6 flex gap-2">
                            <input
                              type="text"
                              value={replyText}
                              onChange={(e) => setReplyText(e.target.value)}
                              placeholder={currentUser ? "Write a reply..." : "Log in to reply"}
                              disabled={!currentUser}
                              className="flex-1 p-2 text-sm border rounded focus:ring-1 focus:ring-blue-500 outline-none"
                            />
                            <button 
                              type="submit"
                              disabled={!currentUser || !replyText.trim()}
                              className="px-3 py-1 bg-blue-500 text-white text-sm rounded hover:bg-blue-600 disabled:opacity-50"
                            >
                              Post
                            </button>
                          </form>
                        )}

                        {/* Replies List */}
                        {c.replies && c.replies.length > 0 && (
                          <div className="mt-4 ml-6 space-y-3 border-l-2 border-gray-200 pl-4">
                            {c.replies.map((r, rIdx) => (
                              <div key={r._id || rIdx} className="bg-white p-3 rounded shadow-sm border border-gray-100">
                                <div className="flex justify-between items-start mb-1">
                                  <span className="font-semibold text-sm">{r.user}</span>
                                  <span className="text-xs text-gray-500">
                                    {new Date(r.timestamp).toLocaleDateString()}
                                  </span>
                                </div>
                                <p className="text-gray-700 text-sm">{r.reply}</p>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                <div className="mt-6 flex gap-4">
  <button
    onClick={() => setIsEditing(true)}
    disabled={!isAuthor()}
    className={`px-4 py-2 rounded text-white 
      ${isAuthor() ? 'bg-yellow-500 hover:bg-yellow-600' : 'bg-gray-400 cursor-not-allowed'}`}
  >
    Edit Blog
  </button>
  <button
    onClick={handleDelete}
    disabled={!isAuthor()}
    className={`px-4 py-2 rounded text-white 
      ${isAuthor() ? 'bg-red-500 hover:bg-red-600' : 'bg-gray-400 cursor-not-allowed'}`}
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