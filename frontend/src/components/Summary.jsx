import React, { useState } from "react";
import axios from "axios";

function Summary({ content, title, setSummary }) {
  const [summary, setLocalSummary] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const fetchSummary = async () => {
    if (content.trim() === "") return;
    setIsLoading(true);
    setLocalSummary("");
    try {
      // Step 1: Request summarization job
      const response = await axios.post("http://localhost:5000/blogs/summarize", { content });
      const jobId = response.data.jobId;
      if (!jobId) throw new Error("No jobId returned from server");
      // Step 2: Poll for result
      let attempts = 0;
      let result = null;
      while (attempts < 30) { // up to 60 seconds
        await new Promise((r) => setTimeout(r, 2000));
        const statusRes = await axios.get(`http://localhost:5000/blogs/summarize/status/${jobId}`);
        if (statusRes.data.status === "completed") {
          result = statusRes.data.summary;
          break;
        } else if (statusRes.data.status === "not_found") {
          setLocalSummary("Summary job not found. Try again.");
          setIsLoading(false);
          return;
        }
        attempts++;
      }
      if (result) {
        setLocalSummary(result);
        setSummary(result);
      } else {
        setLocalSummary("No summary available (timeout).");
      }
    } catch (error) {
      console.error("Error fetching summary:", error);
      setLocalSummary("Failed to fetch summary. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="p-6">
      <h2 className="text-xl font-bold mb-4">"{title}"</h2>
      <textarea
        value={summary}
        onChange={(e) => setLocalSummary(e.target.value)}
        className="w-full p-2 mb-4 border rounded-md"
        rows="6"
        placeholder="Write the summary of your blog. For AI generated summary click USE AI"
      />
      <button
        onClick={fetchSummary}
        className="bg-blue-500 text-white px-4 py-2 rounded-md hover:bg-blue-600"
        disabled={isLoading}
      >
        {isLoading ? "Loading..." : "USE AI"}
      </button>
    </div>
  );
}

export default Summary;
