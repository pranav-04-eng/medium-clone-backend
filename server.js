import express from "express";
import mongoose from "mongoose";
import "dotenv/config";
import bcrypt from "bcrypt";
import { nanoid } from "nanoid";
import jwt from 'jsonwebtoken';
import cors from 'cors';
import admin from 'firebase-admin';
import serviceAccountkey from './react-js-website-firebase-adminsdk-lyc6i-3604e0bff0.json' assert{ type: 'json' };
import User from "./Schema/User.js";
import Blog from "./Schema/Blog.js"
import {getAuth} from "firebase-admin/auth"
import aws from 'aws-sdk';

const server = express();
server.use(express.json());
server.use(cors());
let PORT = 3000;

mongoose.connect(process.env.DB_LOCATION, {
  autoIndex: true,
});

const s3=new aws.S3({
  region:"ap-south-1",
  accessKeyId:process.env.AWS_ACCESS_KEY,
  secretAccessKey:process.env.AWS_SECRET_ACCESS_KEY
})

const generateUploadURL=async ()=>{
  const date=new Date()
  const imageName=`${nanoid()}-${date.getTime()}.jpeg`
 return await s3.getSignedUrlPromise('putObject',{
Bucket:"blogging-webapp-study",
Key:imageName,
Expires:1000,
ContentType:"image/jpeg"
})
}
 
admin.initializeApp({
  credential:admin.credential.cert(serviceAccountkey)
});
let emailRegex = /^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/;
let passwordRegex = /^(?=.*\d)(?=.*[a-z])(?=.*[A-Z]).{6,20}$/;

const formatDatatoSend=(user)=>{
  const access_token=jwt.sign({id:user._id},process.env.SECRET_ACCESS_KEY)
  return {
    access_token,
    profile_img:user.personal_info.profile_img,
    username:user.personal_info.username,
    fullname:user.personal_info.fullname,
  }
}

const verifyJWT=(req,res,next) =>{
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(" ")[1];

  if(token===null){
    return res.status(403).json({error:"No token provided"})
}else{
  jwt.verify(token,process.env.SECRET_ACCESS_KEY,(err,user)=>{
    if(err){
      return res.status(403).json({"error":"Access token is invalid"})
    }
    req.user=user.id;
    next();
})}}


const generateUsername=async (email)=>{
  let username=email.split("@")[0];
  let isUsernameNotUnique=await User.exists({"personal_info.username":username}).then(result=>result)
  
  isUsernameNotUnique?username+=nanoid().substring(0,5):""
  return username;
}
//upload image url route
server.get("/get-upload-url",(req,res)=>{
  generateUploadURL().then(url=>res.status(200).json({uploadURL:url}))
  .catch(err=>res.status(500).json({error:err.message}))

})


server.post("/signup", (req, res) => {
  let { fullname, email, password } = req.body;

  // Data validation
  if (fullname.length < 3) {
    return res
      .status(403)
      .json({ error: "Full name must be at least 3 letters long" });
  }
  if (!email.length) {
    return res.status(403).json({ error: "Enter the email address" });
  }
  if (!emailRegex.test(email)) {
    return res.status(403).json({ error: "Invalid email address" });
  }
  if (!passwordRegex.test(password)) {
    return res.status(403).json({
      error:
        "Password should be 6 to 20 characters long with a numeric digit, 1 lowercase letter, and 1 uppercase letter",
    });
  }

  bcrypt.hash(password, 10, async (err, hashed_password) => {
    if (err) {
      return res.status(500).json({ error: "Error hashing password" });
    }

    let username = await generateUsername(email);
    let user = new User({
      personal_info: { fullname, email, password: hashed_password, username },
    });

    user
      .save()
      .then((result) => res.status(200).json(formatDatatoSend(result)))
      .catch((err) => {
        if (err.code === 11000) {
          res.status(500).json({ error: "email already exists" });
        } else {
          res.status(500).json({ error: err.message });
        }
      });
  });
});

server.post("/signin", (req, res) => {
  let { email, password } = req.body;

  User.findOne({ "personal_info.email": email })
    .then((user) => {
      if (!user) {
        return res.status(403).json({ "error": "email not found" });
      }

      bcrypt.compare(password, user.personal_info.password, (err, result) => {
        if (err) {
          return res.status(403).json({ "error": "error occurred while login, please try again" });
        }

        if (!result) {
          return res.status(403).json({ "error": "Incorrect password" });
        } else {
          return res.status(200).json(formatDatatoSend(user));
        }
      });
    })
    .catch((err) => {
      console.log(err.message);
      return res.status(500).json({ "error": err.message });
    });
});

server.post("/google-auth",async(req,res)=>{
  let {access_token}=req.body

  getAuth()
  .verifyIdToken(access_token)
  .then(async (decodedUser)=>{
    let{email,name,picture}=decodedUser;
    picture=picture.replace("s96-c","s384-c")
    let user =await User.findOne({"personal_info.email":email}).select("personal_info.fullname personal_info.username personal_info.profile_img google_auth")
    .then((u)=> {return u || null})
    .catch(err=>{res.status(500).json({"error":err.message})});
    if(user){
    if(!user.google_auth){
      return res.status(403).json({"error":"This email was signed up without google.Please log in with password"})
    }}
    else{
      let username=await generateUsername(email);
      user=new User({
        personal_info:{
          fullname:name,
          email,
          profile_img:picture,
          username
        },google_auth:true
      })
      await user.save().then((u) => {
        user = u;
        })
        .catch(err=> {
        return res.status(500).json({ "error": err.message })
        })
      }
        return res.status(200).json (formatDatatoSend (user))
      })
      .catch(err=>{return res.status(500).json({"error":"Try with another Google Account"})})
  
}

  )

  server.post("/create-blog", verifyJWT, (req, res) => {
    let authorId = req.user;
    let { title, des, banner, tags, content, draft } = req.body;

    if (!title.length) {
        return res.status(403).json({ error: "You must provide a blog title to publish the blog" });
    }

    if (!des.length || des.length > 200) {
        return res.status(403).json({ error: "You must provide a proper blog description under 200 words to publish the blog" });
    }

    if (!banner.length) {
        return res.status(403).json({ error: "You must provide a blog banner to publish the blog" });
    }

    if (!content.blocks.length) {
        return res.status(403).json({ error: "There must be some blog content to publish it" });
    }

    if (!tags.length || tags.length > 10) {
        return res.status(403).json({ error: "Provide tags in order to publish the blog, maximum 10" });
    }

    tags = tags.map(tag => tag.toLowerCase());
    let blog_id = title.replace(/[^a-zA-Z0-9 ]/g, ' ').replace(/\s+/g, '-').trim() + nanoid();

    let blog = new Blog({
        title, des, banner, content, tags, author: authorId, blog_id, draft: Boolean(draft)
    });

    blog.save()
        .then((blog) => {
            let incrementVal = draft ? 0 : 1;
            return User.findOneAndUpdate(
                { _id:authorId },
                {
                    $inc: { "account_info.total_posts": incrementVal },
                    $push: { "blogs": blog_id }
                }
            ).then(user => {
                res.status(200).json({ id: blog.blog_id });
            }).catch(err => {
              console.log(err)
                res.status(500).json({ error: "Failed to update user information" });
            });
        })
        .catch(err => {
            console.error(err.message);
            res.status(500).json({ error: "Failed to create blog" });
        });
});

server.get('/latest-blogs',(req,res)=>{
  let maxLimit=5;
  Blog.find({draft:false })
  .populate("author",'personal_info.fullname personal_info.username personal_info.profile_img')
  .sort({"publishAt":-1})
  .select("blog_id title des banner activity tags publishedt -_id")
  .limit(maxLimit)
  .then(blogs =>{
    return res.status(200).json({ blogs })})
  .catch((err)=>{
    return res.status(500).json({ error: err.message })})
})
server.get("/trending-blogs",(req,res)=>{
  Blog.find({draft:false })
  .populate("author",'personal_info.fullname personal_info.username personal_info.profile_img')
  .sort({"activity.total_reads":-1})
  .select("blog_id title des banner activity tags publishedt -_id")
  .limit(5)
  .then(blogs =>{
    return res.status(200).json({ blogs })})
  .catch((err)=>{
    return res.status(500).json({ error: err.message })})
})

server.post("/search-blogs", (req, res) => {
  let { tag } = req.body;
  let findQuery = { tags: tag, draft: false };
  let maxLimit = 5;

  Blog.find(findQuery)
    .populate("author", 'personal_info.fullname personal_info.username personal_info.profile_img')
    .sort({ "publishedAt": -1 })
    .select("blog_id title des banner activity tags publishedt -_id")
    .limit(maxLimit)
    .then(blogs => {
      return res.status(200).json({ blogs });
    })
    .catch(err => {
      return res.status(500).json({ error: err.message });
    });
});

//search api
server.get('/blog/:blog_id', (req, res) => {
  const { blog_id } = req.params;

  Blog.findOne({ blog_id, draft: false })
    .populate('author', 'personal_info.fullname personal_info.username personal_info.profile_img')
    .select('blog_id title des banner content tags publishedAt -_id')
    .then(blog => {
      if (!blog) {
        return res.status(404).json({ error: 'Blog not found' });
      }
      res.status(200).json({ blog });
    })
    .catch(err => {
      console.error(err.message);
      res.status(500).json({ error: 'Failed to retrieve the blog' });
    });
});

server.listen(PORT, () => console.log(`Listening on Port ${PORT}`));
