import React, { useState } from "react";
import axios from "axios";

const SearchBar = ({ onSearchResults }) => {
  const [searchText, setSearchText] = useState("");

  const handleSearch = async (e) => {
    const query = e.target.value;
    setSearchText(query);

    if (query.trim().length === 0) {
      onSearchResults([]);
      return;
    }

    const handleSearchResults = (results) => {
      setBlogs(results);
    };

    try {
      const response = await axios.post("http://localhost:5000/blogs/retrieve", {
        titleQuery: query,
      });
      onSearchResults(response.data);
    } catch (error) {
      console.error("Error fetching blogs:", error);
      onSearchResults([]);
    }
  };

  return (
    <input
      type="text"
      placeholder="Search blogs..."
      value={searchText}
      onChange={handleSearch}
      className="w-64 p-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
    />
  );
};

export default SearchBar;

