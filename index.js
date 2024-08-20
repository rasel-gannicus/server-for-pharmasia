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

    // --- adding new user to database after user register or logged in client site
    app.post("/api/v1/addUserData", async (req, res) => {
      const userData = req.body;
      console.log(req.body.email);

      const filter = { email: req.body.email };
      const options = { upsert: true }; // This will insert a new document if no document matches the filter.

      const update = { $set: userData };

      try {
        const result = await userDb.updateOne(filter, update, options); // Use updateOne instead of insertOne.

        console.log(result);

        if (result.upsertedCount > 0) {
          res
            .status(201)
            .json({ message: "New user created successfully", result });
        } else {
          res
            .status(200)
            .json({ message: "User updated successfully", result });
        }
      } catch (error) {
        console.error(error);
        res
          .status(500)
          .json({ message: "Error updating or creating user data", error });
      }
    });

    // --- add a new product to cart
    app.post("/api/v1/addToCart", async (req, res) => {
      const { email, product, status } = req.body; // Expecting email, product data, and status in the request body
      console.log(req.body);

      try {
        // Find the user and check if the product already exists in the cart
        const user = await userDb.findOne({ email });

        if (user) {
          // Ensure the cart array exists
          if (!user.cart) {
            user.cart = [];
          }

          const productIndex = user.cart.findIndex(
            (item) => item._id === product._id
          );

          let result;

          if (productIndex !== -1) {
            // Product already exists in the cart
            if (status === "pending") {
              // Increase quantity if status is 'pending'
              result = await userDb.updateOne(
                { email, "cart._id": product._id },
                {
                  $inc: { "cart.$.quantity": 1 },
                  $set: { "cart.$.status": status },
                }
              );

              res.status(200).json({
                message:
                  "Product quantity increased and status updated in the cart",
                result,
              });
            } else if (status === "confirmed") {
              // Only update the status if it's 'confirmed'
              result = await userDb.updateOne(
                { email, "cart._id": product._id },
                { $set: { "cart.$.status": status } }
              );

              res.status(200).json({
                message: "Product status updated to confirmed in the cart",
                result,
              });
            } else if (status === "wishlist") {
              // Only update the status if it's 'wishlist'
              result = await userDb.updateOne(
                { email, "cart._id": product._id },
                { $set: { "cart.$.wishlist": true } }
              );

              res.status(200).json({
                message: "Product status updated to confirmed in the cart",
                result,
              });
            }
          } else {
            
            if (status === "wishlist") {
              // Product doesn't exist in the cart, so add it with a quantity of 1 and status
              const newProduct = { ...product, wishlist : true };
              result = await userDb.updateOne(
                { email },
                { $push: { cart: newProduct } }
              );

              res.status(200).json({
                message: "Product added to the cart with status",
                result,
              });
            } else {
              // Product doesn't exist in the cart, so add it with a quantity of 1 and status
              const newProduct = { ...product, quantity: 1, status };
              result = await userDb.updateOne(
                { email },
                { $push: { cart: newProduct } }
              );

              res.status(200).json({
                message: "Product added to the cart with status",
                result,
              });
            }
          }
        } else {
          // If the user doesn't exist, return an error
          res.status(404).json({ message: "User not found" });
        }
      } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Error updating cart", error });
      }
    });

    // --- modifying cart - increase, decrease , delete
    app.patch("/api/v1/modifyCart", async (req, res) => {
      try {
        const { data, email, modifyType } = req.body;
        const { _id: productId } = data;
        console.log({ modifyType });
        // console.log(req.body);

        const filter = { email, "cart._id": productId };
        const update = {};

        let currentQuantity;
        // Step 1: Retrieve the current quantity
        const user = await userDb.findOne(filter);
        if (user) {
          const cartItem = user.cart.find(
            (item) => item._id.toString() === productId
          );
          if (cartItem) {
            currentQuantity = cartItem.quantity;
          } else {
            return res.status(404).json({ error: "Product not found in cart" });
          }
        } else {
          return res.status(404).json({ error: "User not found" });
        }

        switch (modifyType) {
          case "increase":
            if (currentQuantity < 5) {
              update["$inc"] = { "cart.$.quantity": 1 };
            } else {
              return res
                .status(400)
                .json({ error: "Cannot increase quantity above 5" });
            }
            break;
          case "decrease":
            if (currentQuantity > 1) {
              update["$inc"] = { "cart.$.quantity": -1 };
            } else {
              return res
                .status(400)
                .json({ error: "Cannot decrease quantity below 1" });
            }
            break;
          case "delete":
            update["$set"] = { "cart.$.status": "deleted" };
            update["$set"] = { "cart.$.quantity": 0 };
            break;
          case "confirmed":
            update["$set"] = { "cart.$.status": "confirmed" };
            break;
          default:
            return res.status(400).json({ error: "Invalid modifyType" });
        }

        const result = await userDb.updateOne(filter, update);

        if (result.matchedCount > 0) {
          res.json({ message: "Cart updated successfully" });
          console.log("updated");
        } else {
          res.status(404).json({ error: "User or product not found" });
          console.log("error");
        }
      } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Internal Server Error" });
      }
    });

    // --- Get cart information for a user
    app.get("/api/v1/getCart", async (req, res) => {
      const { email } = req.query; // Expecting the user's email in the query string

      try {
        // Find the user by email
        const user = await userDb.findOne({ email });

        if (user && user.cart) {
          // Return the user's cart information
          res.status(200).json({ cart: user.cart });
        } else {
          // If the user doesn't exist or has an empty cart, return an empty array
          res.status(200).json({ cart: [] });
        }
      } catch (error) {
        console.error(error);
        res
          .status(500)
          .json({ message: "Error retrieving cart information", error });
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
