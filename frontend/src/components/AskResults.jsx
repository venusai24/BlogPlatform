import React, { useState, useEffect } from "react";
import { useLocation, Link } from "react-router-dom";
import axios from "axios";
import NavBar from "./NavBar";

const AskResults = () => {
    const [answer, setAnswer] = useState("");
    const [sources, setSources] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    
    const location = useLocation();
    const queryParams = new URLSearchParams(location.search);
    const query = queryParams.get("q") || "";

    useEffect(() => {
        const fetchAnswer = async () => {
            if (!query) {
                setIsLoading(false);
                return;
            }
            try {
                setIsLoading(true);
                const response = await axios.post("http://localhost:5000/blogs/ask", {
                    query,
                    detailLevel: "detailed",
                    limit: 5
                });
                setAnswer(response.data.answer);
                setSources(response.data.sources);
            } catch (error) {
                console.error("Error fetching AI answer:", error);
                setAnswer("Sorry, there was an error generating the answer.");
            } finally {
                setIsLoading(false);
            }
        };

        fetchAnswer();
    }, [query]);

    return (
        <div className="bg-gray-50 min-h-screen">
            <NavBar />
            <div className="container mx-auto px-4 py-8 max-w-4xl">
                <div className="mb-8">
                    <h1 className="text-3xl font-bold text-gray-800 mb-2">Ask AI</h1>
                    <p className="text-lg text-gray-600 italic">"{query}"</p>
                </div>

                {isLoading ? (
                    <div className="bg-white rounded-lg shadow p-8 text-center">
                        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
                        <p className="text-gray-600">Generating a detailed answer from our blogs...</p>
                    </div>
                ) : (
                    <div className="space-y-8">
                        {/* AI Answer Section */}
                        <div className="bg-white rounded-xl shadow-md p-6 border-l-4 border-blue-500">
                            <div className="flex items-center mb-4 text-blue-600">
                                <svg className="w-6 h-6 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg>
                                <h2 className="text-xl font-semibold">AI Synthesis</h2>
                            </div>
                            <div className="prose max-w-none text-gray-800 leading-relaxed whitespace-pre-wrap">
                                {answer}
                            </div>
                        </div>

                        {/* Sources Section */}
                        {sources.length > 0 && (
                            <div>
                                <h3 className="text-xl font-bold text-gray-800 mb-4">Sources Cited</h3>
                                <div className="grid gap-4">
                                    {sources.map((source, index) => (
                                        <Link 
                                            key={index} 
                                            to={`/blog/${source.id}`}
                                            className="bg-white rounded-lg shadow p-4 hover:shadow-md transition-shadow border border-gray-100 flex items-start"
                                        >
                                            <div className="bg-gray-100 text-gray-500 rounded-full h-8 w-8 flex items-center justify-center font-bold mr-4 flex-shrink-0">
                                                {index + 1}
                                            </div>
                                            <div>
                                                <h4 className="font-semibold text-blue-600 hover:underline">{source.title}</h4>
                                                <p className="text-sm text-gray-500 mt-1 line-clamp-2">{source.snippet}</p>
                                            </div>
                                        </Link>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};

export default AskResults;
