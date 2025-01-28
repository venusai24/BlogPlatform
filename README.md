# IntelliBlog
Blog platform 

<br>

MERN stack Blogging application which uses MongoDB database to store blogs and uses LLMs to summarize content in blogs.
To reduce the overuse of LLMs for every summarization Redis is used for caching the summarizes for different tokens which can directly be used to summarize other content without using LLMs. 

<br>

Pages:

<br>

Authentication page:
![Screenshot 2025-01-28 201607](https://github.com/user-attachments/assets/528fb5ae-eb81-4305-b9de-043794c9f066)

<br>
Home page:

![Screenshot 2025-01-28 201437](https://github.com/user-attachments/assets/7984b9e0-f95e-40a6-9b8a-cad4999dd7f2)



<br>
Uploading Page:
![Screenshot 2025-01-28 201510](https://github.com/user-attachments/assets/734b9954-28e1-40a0-bf75-68db977d8e5e)
![Screenshot 2025-01-28 201522](https://github.com/user-attachments/assets/bc9ba648-5b71-40d0-9d4a-77ea7f3938e6)


<br>

Subscription to be implemented later. Also trying to implement summary based searching of blogs.
<br>
Setup:
run backend on the repository itself by typing 
nodemon server.js. By default the port for backend is 5000

<br>

run frontend on another terminal by changing directory to frontend and then typing npm start. By default the port for frontend is 3000

<br>

The GROG cloud API key  is not provided and the user who is using this application should make his own groqcloud account and put his own api key.

<br>
