import React, { useState, useEffect } from "react";
import axios from "axios";
import { Link } from "react-router-dom";

const NavBar = ({ onSearchResults = () => {} }) => {
  const [searchText, setSearchText] = useState("");
  const [showSearch, setShowSearch] = useState(false);
  const [searchType, setSearchType] = useState("title"); // "title" or "semantic"
  const [isLoading, setIsLoading] = useState(false);
  const [showSearchOptions, setShowSearchOptions] = useState(false);
  const [searchResults, setSearchResults] = useState([]);
  const [debounceTimer, setDebounceTimer] = useState(null);
  
  // AI State
  const [aiAnswer, setAiAnswer] = useState(null);
  const [isAiLoading, setIsAiLoading] = useState(false);

  // Debounced search to avoid too many API calls
  useEffect(() => {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }

    if (searchText.trim()) {
      const timer = setTimeout(() => {
        handleSearch(searchText);
      }, 300); // 300ms delay
      setDebounceTimer(timer);
    } else {
      setSearchResults([]);
      onSearchResults([]);
    }

    return () => {
      if (debounceTimer) {
        clearTimeout(debounceTimer);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchText, searchType]);

  const toggleSearch = () => {
    setShowSearch(!showSearch);
    if (showSearch) {
      setSearchText("");
      setSearchResults([]);
      setAiAnswer(null);
      onSearchResults([]);
      setShowSearchOptions(false);
    }
  };

  const handleSearchInputChange = (e) => {
    const query = e.target.value;
    setSearchText(query);
    setAiAnswer(null);
  };

  const handleSearch = async (query) => {
    if (!query.trim()) {
      setSearchResults([]);
      onSearchResults([]);
      return;
    }

    setIsLoading(true);
    
    try {
      let response;
      
      if (searchType === "semantic") {
        // Use semantic search
        response = await axios.get("http://localhost:5000/blogs/search", {
          params: {
            query: query,
            searchType: 'content',
            limit: 10
          }
        });
        
        // Use the simplified response format directly
        const transformedResults = response.data.map(result => ({
          _id: result.id,
          title: result.title,
          author: result.author || 'Unknown',
          similarity: 3*result.score,
          matchField: result.snippet ? 'content' : 'title'
        }));
        
        setSearchResults(transformedResults);
        onSearchResults(transformedResults);
      } else {
        // Use title-based search
        response = await axios.post("http://localhost:5000/blogs/semanticSearchbyTitle", {
          query: query,
        });
        
        // Transform title search results to match the semantic search format
        const transformedResults = response.data.results.map(result => ({
          _id: result._id,
          title: result.title,
          author: result.author || 'Unknown',
          similarity: result.similarity,
          createdAt: result.createdAt,
          matchField: 'title'
        }));
        
        setSearchResults(transformedResults);
        onSearchResults(transformedResults);
      }
    } catch (error) {
      console.error("Error fetching search results:", error);
      setSearchResults([]);
      onSearchResults([]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSearchTypeChange = (type) => {
    setSearchType(type);
    setShowSearchOptions(false);
    if (searchText.trim()) {
      handleSearch(searchText);
    }
  };

  const handleAskAI = async () => {
    if (!searchText.trim()) return;
    
    setIsAiLoading(true);
    setAiAnswer(null);
    try {
      const response = await axios.post("http://localhost:5000/blogs/ask", {
        query: searchText,
        detailLevel: "brief"
      });
      setAiAnswer(response.data.answer);
    } catch (error) {
      console.error("Error asking AI:", error);
      setAiAnswer("Sorry, I encountered an error while trying to answer your question.");
    } finally {
      setIsAiLoading(false);
    }
  };

  const clearSearch = () => {
    setSearchText("");
    setSearchResults([]);
    setAiAnswer(null);
    onSearchResults([]);
  };

  return (
    <div className="w-full shadow-md bg-white relative">
      <nav className="flex justify-between items-center px-6 py-4">
        {/* Logo */}
        <div className="text-xl font-bold flex items-center">IntelliBlog</div>

        {/* Search Bar Container */}
        <div className="flex items-center space-x-2 relative">
          {showSearch && (
            <div className="flex items-center space-x-2">
              {/* Search Type Toggle */}
              <div className="relative">
                <button
                  onClick={() => setShowSearchOptions(!showSearchOptions)}
                  className={`px-3 py-2 text-xs rounded-md border transition-colors ${
                    searchType === "semantic" 
                      ? "bg-blue-100 border-blue-300 text-blue-700" 
                      : "bg-gray-100 border-gray-300 text-gray-700"
                  } hover:bg-gray-200 focus:outline-none`}
                >
                  {searchType === "semantic" ? "🧠 Smart" : "📝 Title"}
                  <span className="ml-1">▼</span>
                </button>
                
                {/* Search Options Dropdown */}
                {showSearchOptions && (
                  <div className="absolute top-full left-0 mt-1 bg-white border rounded-md shadow-lg z-50 min-w-[150px]">
                    <button
                      onClick={() => handleSearchTypeChange("title")}
                      className={`w-full text-left px-3 py-2 text-sm hover:bg-gray-100 ${
                        searchType === "title" ? "bg-blue-50 text-blue-700" : "text-gray-700"
                      }`}
                    >
                      📝 Title Search
                      <div className="text-xs text-gray-500">Search by title keywords</div>
                    </button>
                    <button
                      onClick={() => handleSearchTypeChange("semantic")}
                      className={`w-full text-left px-3 py-2 text-sm hover:bg-gray-100 ${
                        searchType === "semantic" ? "bg-blue-50 text-blue-700" : "text-gray-700"
                      }`}
                    >
                      🧠 Smart Search
                      <div className="text-xs text-gray-500">Search by meaning & context</div>
                    </button>
                  </div>
                )}
              </div>

              {/* Search Input */}
              <div className="relative">
                <input
                  type="text"
                  placeholder={
                    searchType === "semantic" 
                      ? "Search by meaning... (e.g., 'machine learning')" 
                      : "Search blog titles..."
                  }
                  value={searchText}
                  onChange={handleSearchInputChange}
                  className="p-2 pl-3 pr-8 border rounded-md text-black focus:outline-none focus:ring-2 focus:ring-blue-500 w-64"
                />
                
                {/* Loading Indicator */}
                {isLoading && (
                  <div className="absolute right-8 top-1/2 transform -translate-y-1/2">
                    <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
                  </div>
                )}
                
                {/* Clear Button */}
                {searchText && (
                  <button
                    onClick={clearSearch}
                    className="absolute right-2 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  >
                    ✕
                  </button>
                )}
              </div>

              {/* Search Results Count */}
              {searchText && searchResults.length > 0 && (
                <div className="text-xs text-gray-500 whitespace-nowrap">
                  {searchResults.length} result{searchResults.length !== 1 ? 's' : ''}
                </div>
              )}
            </div>
          )}
          
          {/* Search Toggle Button */}
          <button 
            onClick={toggleSearch} 
            className={`text-gray-600 hover:text-black transition-colors p-2 rounded-full ${
              showSearch ? "bg-gray-100" : ""
            }`}
          >
            {showSearch ? "✕" : "🔍"}
          </button>
        </div>

        {/* Navigation Links */}
        <div className="hidden md:flex space-x-6">
          {["Dashboard", "Post", "Subscriptions"].map((item) => (
            <Link
              key={item}
              to={item === "Dashboard" ? "/home" : `/${item}`}
              className="text-gray-600 hover:text-black transition duration-200"
            >
              {item.charAt(0).toUpperCase() + item.slice(1)}
            </Link>
          ))}
        </div>

        {/* My Posts Button */}
        <div className="flex gap-4">
          <Link
            to="/MyPosts"
            className="px-4 py-2 border rounded-full text-gray-600 hover:bg-gray-100"
          >
            My Posts
          </Link>
          <Link
            to="/account"
            className="px-4 py-2 bg-blue-500 text-white rounded-full hover:bg-blue-600 font-semibold"
          >
            Account
          </Link>
        </div>
      </nav>

      {/* Search Results Preview (Optional) */}
      {showSearch && searchText && (
        <div className="absolute top-full left-0 right-0 bg-white border-t shadow-lg z-40 max-h-[500px] overflow-y-auto">
          <div className="p-4">
            
            {/* Ask AI Section */}
            <div className="mb-4 p-4 bg-gradient-to-r from-blue-50 to-indigo-50 rounded-lg border border-blue-100">
                <div className="flex justify-between items-center mb-2">
                    <h3 className="font-semibold text-blue-800 flex items-center">
                        <span className="mr-2">✨</span> Ask AI about "{searchText}"
                    </h3>
                    <Link 
                        to={`/ask?q=${encodeURIComponent(searchText)}`}
                        className="text-xs bg-white text-blue-600 px-3 py-1 rounded-full border border-blue-200 hover:bg-blue-50 transition-colors"
                        onClick={() => setShowSearch(false)}
                    >
                        Detailed View →
                    </Link>
                </div>
                
                {!aiAnswer && !isAiLoading && (
                    <button 
                        onClick={handleAskAI}
                        className="w-full text-center py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md text-sm transition-colors"
                    >
                        Generate Brief Answer
                    </button>
                )}
                
                {isAiLoading && (
                    <div className="flex items-center justify-center space-x-2 py-4">
                        <div className="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
                        <span className="text-sm text-blue-600">Synthesizing from blogs...</span>
                    </div>
                )}
                
                {aiAnswer && (
                    <div className="text-sm text-gray-700 mt-2 p-3 bg-white rounded border border-blue-100 shadow-sm leading-relaxed whitespace-pre-wrap">
                        {aiAnswer}
                    </div>
                )}
            </div>

            {searchResults.length > 0 && (
              <>
                <div className="text-sm text-gray-600 mb-2 font-semibold border-b pb-1">
                  {searchType === "semantic" ? "Smart Search Results:" : "Title Search Results:"}
                </div>
            <div className="space-y-2">
              {searchResults.slice(0, 5).map((result, index) => (
                <Link 
                  to={`/blog/${result._id}`} 
                  key={result._id || index}
                  className="block p-2 hover:bg-gray-50 rounded border-l-2 border-transparent hover:border-blue-500"
          >
                  <div className="font-medium text-sm">{result.title}</div>
                  <div className="text-xs text-gray-500 flex justify-between items-center">
                    <div>
                      by {result.author}
                      {result.similarity && (
                        <span className="ml-2 px-2 py-1 bg-blue-100 text-blue-700 rounded">
                          {Math.round(result.similarity * 100)}% match
                          {result.matchField && ` (${result.matchField})`}
                        </span>
                      )}
                    </div>
                    {result.createdAt && (
                      <div className="text-xs text-gray-400">
                        {new Date(result.createdAt).toLocaleDateString()}
                      </div>
                    )}
                  </div>
                </Link>
              ))}
              {searchResults.length > 5 && (
                <div className="text-xs text-gray-500 text-center pt-2">
                  and {searchResults.length - 5} more results...
                </div>
              )}
            </div>
            </>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default NavBar;