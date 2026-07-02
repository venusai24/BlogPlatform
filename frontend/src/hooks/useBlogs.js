import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';

const API_URL = 'http://localhost:5000/blogs';

// Hook to fetch all blogs or by author
export const useBlogs = (author = null) => {
  return useQuery({
    queryKey: ['blogs', { author }],
    queryFn: async () => {
      const params = author ? { author } : {};
      const { data } = await axios.get(API_URL, { params });
      return data;
    },
    staleTime: 60000, // 1 minute stale time
  });
};

// Hook to fetch a single blog
export const useBlog = (id) => {
  return useQuery({
    queryKey: ['blog', id],
    queryFn: async () => {
      const { data } = await axios.get(`${API_URL}/${id}`);
      return data.blog;
    },
    enabled: !!id,
  });
};

// Hook for adding a comment with optimistic updates
export const useAddComment = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, comment }) => {
      const { data } = await axios.post(
        `${API_URL}/${id}/comments`,
        { comment },
        { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } }
      );
      return data;
    },
    onMutate: async ({ id, comment }) => {
      // Cancel any outgoing refetches
      await queryClient.cancelQueries({ queryKey: ['blog', id] });

      // Snapshot the previous value
      const previousBlog = queryClient.getQueryData(['blog', id]);

      // Optimistically update to the new value
      queryClient.setQueryData(['blog', id], (old) => {
        if (!old) return old;
        const user = localStorage.getItem('username') || 'Anonymous';
        return {
          ...old,
          comments: [...(old.comments || []), { user, comment, timestamp: new Date().toISOString() }],
        };
      });

      // Return a context object with the snapshotted value
      return { previousBlog };
    },
    onError: (err, newComment, context) => {
      // Rollback on error
      if (context?.previousBlog) {
        queryClient.setQueryData(['blog', newComment.id], context.previousBlog);
      }
    },
    onSettled: (data, error, variables) => {
      // Always refetch after error or success to ensure sync
      queryClient.invalidateQueries({ queryKey: ['blog', variables.id] });
    },
  });
};

// Hook for adding a reply to a comment with optimistic updates
export const useAddReply = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, commentId, reply }) => {
      const { data } = await axios.post(
        `${API_URL}/${id}/comments/${commentId}/replies`,
        { reply },
        { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } }
      );
      return data;
    },
    onMutate: async ({ id, commentId, reply }) => {
      await queryClient.cancelQueries({ queryKey: ['blog', id] });
      const previousBlog = queryClient.getQueryData(['blog', id]);

      queryClient.setQueryData(['blog', id], (old) => {
        if (!old) return old;
        const user = localStorage.getItem('username') || 'Anonymous';
        
        const newComments = old.comments.map(c => {
          if (c._id === commentId) {
            return {
              ...c,
              replies: [...(c.replies || []), { user, reply, timestamp: new Date().toISOString() }]
            };
          }
          return c;
        });

        return { ...old, comments: newComments };
      });

      return { previousBlog };
    },
    onError: (err, variables, context) => {
      if (context?.previousBlog) {
        queryClient.setQueryData(['blog', variables.id], context.previousBlog);
      }
    },
    onSettled: (data, error, variables) => {
      queryClient.invalidateQueries({ queryKey: ['blog', variables.id] });
    },
  });
};

// Hook for liking a blog with optimistic updates
export const useLikeBlog = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id) => {
      const { data } = await axios.put(
        `${API_URL}/${id}/like`,
        {},
        { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } }
      );
      return data;
    },
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: ['blog', id] });
      const previousBlog = queryClient.getQueryData(['blog', id]);

      queryClient.setQueryData(['blog', id], (old) => {
        if (!old) return old;
        
        const username = localStorage.getItem('username');
        if (!username || old.author === username) return old; // Don't allow author to like

        const likedBy = old.likedBy || [];
        const isLiked = likedBy.includes(username);
        
        const newLikedBy = isLiked 
          ? likedBy.filter(u => u !== username) 
          : [...likedBy, username];
          
        const newLikesCount = isLiked
          ? Math.max((old.likes || 1) - 1, 0)
          : (old.likes || 0) + 1;

        return { 
          ...old, 
          likes: newLikesCount,
          likedBy: newLikedBy
        };
      });

      return { previousBlog };
    },
    onError: (err, id, context) => {
      if (context?.previousBlog) {
        queryClient.setQueryData(['blog', id], context.previousBlog);
      }
    },
    onSettled: (data, error, id) => {
      queryClient.invalidateQueries({ queryKey: ['blog', id] });
    },
  });
};
