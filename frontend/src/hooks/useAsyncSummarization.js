import { useState, useRef } from 'react';
import axios from 'axios';

export function useAsyncSummarization() {
  const [jobId, setJobId] = useState(null);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const pollRef = useRef();

  const submitSummarization = async (content, model) => {
    setLoading(true);
    setError(null);
    setSummary(null);
    setJobId(null);
    try {
      const response = await axios.post('http://localhost:5000/blogs/summarize', { content, model });
      setJobId(response.data.jobId);
      pollForResult(response.data.jobId);
    } catch (err) {
      setError('Failed to submit summarization job.');
      setLoading(false);
    }
  };

  const pollForResult = (id) => {
    pollRef.current = setInterval(async () => {
      try {
        const res = await axios.get(`http://localhost:5000/blogs/summarize/status/${id}`);
        if (res.data.status === 'completed') {
          setSummary(res.data.summary);
          setLoading(false);
          clearInterval(pollRef.current);
        } else if (res.data.status === 'not_found') {
          setError('Job not found.');
          setLoading(false);
          clearInterval(pollRef.current);
        }
      } catch (err) {
        setError('Error polling for summary.');
        setLoading(false);
        clearInterval(pollRef.current);
      }
    }, 2000);
  };

  return { submitSummarization, summary, loading, error, jobId };
}
