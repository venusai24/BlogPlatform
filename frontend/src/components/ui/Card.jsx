import React from "react";

export const Card = ({ children, className = "", onClick }) => {
  return (
    <div
      className={`card ${className}`}
      onClick={onClick} 
      role="button" 
      tabIndex={0} 
    >
      {children}
    </div>
  );
};

export const CardContent = ({ children, className = "" }) => {
  return <div className={`card-content ${className}`}>{children}</div>;
};


  