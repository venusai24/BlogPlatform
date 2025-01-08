import React, { useState } from "react";
import axios from "axios";
import { Link } from "react-router-dom";

const NavBar = ({ onSearchResults }) => {
  const [searchText, setSearchText] = useState("");
  const [showSearch, setShowSearch] = useState(false);

  const toggleSearch = () => {
    setShowSearch(!showSearch);
  };

  const handleSearch = async (e) => {
    const query = e.target.value;
    setSearchText(query);

    try {
      const response = await axios.post("http://localhost:5000/blogs/retrieve", {
        titleQuery: query,
      });

      onSearchResults(response.data); // Pass search results to Home
    } catch (error) {
      console.error("Error fetching search results:", error);
      onSearchResults([]); // Reset results on error
    }
  };

  return (
    <div className="w-full shadow-md bg-white">
      <nav className="flex justify-between items-center px-6 py-4">
        {/* Logo */}
        <div className="text-xl font-bold flex items-center">IntelliBlog</div>

        {/* Search Bar */}
        <div className="flex items-center space-x-4">
          {showSearch && (
            <input
              type="text"
              placeholder="Search blogs..."
              value={searchText}
              onChange={handleSearch}
              className="p-2 border rounded-md text-black focus:outline-none"
            />
          )}
          <button onClick={toggleSearch} className="text-gray-600 hover:text-black">
            🔍
          </button>
        </div>

        {/* Navigation Links */}
        <div className="hidden md:flex space-x-6">
          {["Dashboard", "Post", "Subscriptions"].map((item) => (
            <Link
              key={item}
              to={`/${item}`}
              className="text-gray-600 hover:text-black transition duration-200"
            >
              {item.charAt(0).toUpperCase() + item.slice(1)}
            </Link>
          ))}
        </div>

        {/* My Posts Button */}
        <div>
          <a
            href="#"
            className="px-4 py-2 border rounded-full text-gray-600 hover:bg-gray-100"
          >
            My Posts
          </a>
        </div>
      </nav>
    </div>
  );
};

export default NavBar;
