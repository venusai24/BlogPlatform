# IntelliBlog
Blog platform 

<br>

MERN stack Blogging application which uses MongoDB database to store blogs and uses LLMs to summarize content in blogs.
TO reduce the overuse of LLMs for every summarization Redis is used for caching the summarizes for different tokens which can directly be used to summarize other content without using LLMs.

<br>

Pages:

<br>

Authentication page:

<br>
Home page:

<br>
Uploading Page:
<br>

Subscription to be implemented later. Also trying to implement summary based searching of blogs.
<br>
Setup:
run backend on the repository itself by typing 
nodemon server.js. By default the port for backend is 5000

<br>

run frontend on another terminal by changing directory to frontend and then typing npm start. By default the port for frontend is 3000

<br>
Sample .env file:
<br>

DB_HOST=<hostname for eg-"localhost">
<br>
DB_PASSWORD=<password>
<br>
DB_USER=<sql db user>
<br>
DB_NAME="<database name for sql database>"
<br>
DATABASE_URI = "<database uri for mongodb database>"
<br>