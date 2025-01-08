import React, { useState } from 'react';

const SearchBar = () => {
  const [searchText, setSearchText] = useState('');

  const handleSearch = (e) => {
    setSearchText(e.target.value);
  };

  return (
    <input
      type="text"
      placeholder="Search..."
      value={searchText}
      onChange={handleSearch}
      className="w-64 p-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
    />
  );
};

export default SearchBar;
