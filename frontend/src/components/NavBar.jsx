import React, { useState } from 'react';
import SearchBar from './SearchBar';

const NavBar = () => {
  const [showSearch, setShowSearch] = useState(false);

  const toggleSearch = () => {
    setShowSearch(!showSearch);
  };

  return (
    <div className="w-full shadow-md bg-white">
      <nav className="flex justify-between items-center px-6 py-4">
        {/* Logo */}
        <div className="text-xl font-bold flex items-center">
          IntelliBlog
        </div>

        {/* Search Bar */}
        <div className="flex items-center space-x-4">
          {showSearch && <SearchBar />}
          <button onClick={toggleSearch} className="text-gray-600 hover:text-black">
            🔍
          </button>
        </div>

        {/* Navigation Links */}
        <div className="hidden md:flex space-x-6">
          {['Dashboard', 'Post', 'Subscriptions'].map((item) => (
            <a
              key={item}
              href="#"
              className="text-gray-600 hover:text-black transition duration-200"
            >
              {item}
            </a>
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
