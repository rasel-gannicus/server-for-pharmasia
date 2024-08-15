require("dotenv").config();
const express = require("express");
const app = express();
const port = 2500;
const cors = require("cors");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

app.use(cors());
app.use(express.json());

const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const uri = process.env.MONGODB_URI;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    const userDb = client.db("Pharmasia").collection("users");

    // --- adding user data

    // app.patch("/api/v1/addUserData", async (req, res) => {
    //   const userData = req.body;
    //   console.log("user before : ", req.body);

    //   const filter = { email: req.body.email };
    //   const options = { upsert: true };

    //   // Remove the _id field if it exists in the request body
    //   if (userData._id) {
    //     delete userData._id;
    //   }

    //   const update = { $set: userData };

    //   try {
    //     const result = await userDb.updateOne(filter, update, options);

    //     console.log(result);

    //     res.status(200).json({ message: "User updated successfully", result });
    //   } catch (error) {
    //     console.error(error);
    //     res.status(500).json({ message: "Error updating user data", error });
    //   }
    // });

    app.patch("/api/v1/addUserData", async (req, res) => {
      const { email, product } = req.body;
      
      const filter = { email };
      const options = { upsert: true };
    
      // Remove the _id field if it exists in the request body
      if (req.body._id) {
        delete req.body._id;
      }
    
      try {
        if (product) {
          // If product data is present, handle product addition logic
          const user = await userDb.findOne(filter);
    
          if (user) {
            // Ensure products array exists
            const products = user.products || [];
    
            const existingProduct = products.find((p) => p._id === product._id);
    
            if (existingProduct) {
              // Product exists, so increase the quantity
              const updatedProducts = products.map((p) =>
                p._id === product._id ? { ...p, quantity: p.quantity + 1 } : p
              );
    
              await userDb.updateOne(
                filter,
                { $set: { products: updatedProducts } },
                options
              );
            } else {
              // Product doesn't exist, add it to the array with quantity 1
              product.quantity = 1;
              await userDb.updateOne(
                filter,
                { $push: { products: product } },
                options
              );
            }
          } else {
            // If the user doesn't exist, create a new user with the product in the array
            product.quantity = 1;
            const newUser = {
              email,
              products: [product],
              // Include any other default fields here if needed
            };
            await userDb.updateOne(filter, { $set: newUser }, options);
          }
        } else {
          // If no product data is present, assume this is a request to add/update user info only
          const update = { $set: req.body };
          await userDb.updateOne(filter, update, options);
        }
    
        res.status(200).json({ message: "User updated successfully" });
      } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Error updating user data", error });
      }
    });
    
    
    

    //-- getting user info
    app.get("/api/v1/userInfo/:email", async (req, res) => {
      const { email } = req.params;
      try {
        const user = await userDb.findOne({ email });
        if (user) {
          res.status(200).json(user);
        } else {
          res.status(404).json({ message: "User not found" });
        }
      } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Error retrieving user data", error });
      }
    });

    // User Registration
    app.post("/api/v1/register", async (req, res) => {
      const { name, email, password } = req.body;
      console.log(req.body);

      // Check if email already exists
      const existingUser = await userDb.findOne({ email });
      if (existingUser) {
        return res.status(400).json({
          success: false,
          message: "User already exist !!!",
        });
      }

      // Hash the password
      const hashedPassword = await bcrypt.hash(password, 10);

      // Insert user into the database
      await userDb.insertOne({
        name,
        email,
        password: hashedPassword,
        role: "user",
      });

      res.status(201).json({
        success: true,
        message: "User registered successfully !",
      });
    });

    // User Login
    app.post("/api/v1/login", async (req, res) => {
      const { email, password } = req.body;

      // Find user by email
      const user = await userDb.findOne({ email });
      if (!user) {
        return res.status(401).json({ message: "Invalid email or password" });
      }

      // Compare hashed password
      const isPasswordValid = await bcrypt.compare(password, user.password);
      if (!isPasswordValid) {
        return res.status(401).json({ message: "Invalid email or password" });
      }

      // Generate JWT token
      const token = jwt.sign(
        { email: user.email, role: user.role },
        process.env.JWT_SECRET,
        {
          expiresIn: process.env.EXPIRES_IN,
        }
      );

      res.json({
        success: true,
        message: "User successfully logged in!",
        user,
        accessToken: token,
      });
    });
  } finally {
    // await client.close();
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Server running successfully !");
});

app.listen(process.env.PORT, () => {
  console.log(`Listening from ${port}`);
});
