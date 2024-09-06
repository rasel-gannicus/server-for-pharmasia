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

      const filter = { email: req.body.email };
      const options = { upsert: true }; // This will insert a new document if no document matches the filter.

      const update = { $set: userData };

      try {
        const result = await userDb.updateOne(filter, update, options); // Use updateOne instead of insertOne.

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
                message: "Product added to the cart ",
                result,
              });
            } else if (status === "confirmed") {
              // Only update the status if it's 'confirmed'
              result = await userDb.updateOne(
                { email, "cart._id": product._id },
                { $set: { "cart.$.status": status } }
              );

              res.status(200).json({
                message: "Thank you for your order !",
                result,
              });
            } else if (status === "wishlist") {
              // Only update the status if it's 'wishlist'
              result = await userDb.updateOne(
                { email, "cart._id": product._id },
                { $set: { "cart.$.wishlist": true } }
              );

              res.status(200).json({
                message: "Product added to the Wishlist",
                result,
              });
            }
          } else {
            if (status === "wishlist") {
              // Product doesn't exist in the cart, so add it with a quantity of 1 and status
              const newProduct = { ...product, wishlist: true };
              result = await userDb.updateOne(
                { email },
                { $push: { cart: newProduct } }
              );

              res.status(200).json({
                message: "Product added to the Wishlist",
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
                message: "Product added to the cart ",
                result,
              });
            }
          }
          console.log({ result });
        } else {
          // If the user doesn't exist, return an error
          res.status(404).json({ message: "User not found" });
        }
      } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Error updating cart", error });
      }
    });

    //--- modifying items in cart
    app.patch("/api/v1/modifyCart", async (req, res) => {
      try {
        let { data, email, modifyType } = req.body; // `data` is now an array of products
        if (!Array.isArray(data) || data.length === 0) {
          data = [data];
          // return res
          //   .status(400)
          //   .json({ error: "Invalid or empty product array" });
        }

        const user = await userDb.findOne({ email });
        if (!user) {
          return res.status(404).json({ error: "User not found" });
        }

        const updates = data.map((product) => {
          const { _id: productId } = product;
          const cartItem = user.cart.find(
            (item) => item._id.toString() === productId
          );

          if (!cartItem) {
            return {
              productId,
              status: 404,
              message: "Product not found in cart",
            };
          }

          let update = {};

          switch (modifyType) {
            case "increase":
              if (cartItem.quantity < 5) {
                update["$inc"] = { "cart.$[elem].quantity": 1 };
              } else {
                return {
                  productId,
                  status: 400,
                  message: "Cannot increase quantity above 5",
                };
              }
              break;

            case "decrease":
              if (cartItem.quantity > 1) {
                update["$inc"] = { "cart.$[elem].quantity": -1 };
              } else {
                return {
                  productId,
                  status: 400,
                  message: "Cannot decrease quantity below 1",
                };
              }
              break;

            case "delete":
              update["$set"] = {
                "cart.$[elem].status": "deleted",
                "cart.$[elem].quantity": 0,
              };
              break;

            case "confirmed":
              update["$set"] = {
                "cart.$[elem].status": "confirmed",
                "cart.$[elem].quantity": 0,
              };
              break;

            case "wishlist_false":
              update["$set"] = { "cart.$[elem].wishlist": false };
              break;

            default:
              return { productId, status: 400, message: "Invalid modifyType" };
          }

          return {
            filter: { email, "cart._id": productId },
            update,
            arrayFilters: [{ "elem._id": productId }],
            productId,
          };
        });

        // Execute all updates
        const results = await Promise.all(
          updates.map(async (operation) => {
            if (operation.status) {
              return operation; // This is an error operation
            }

            const { filter, update, arrayFilters } = operation;
            const result = await userDb.updateOne(filter, update, {
              arrayFilters,
            });

            if (result.matchedCount > 0) {
              return {
                productId: operation.productId,
                status: 200,
                message: "Cart updated successfully",
              };
            } else {
              return {
                productId: operation.productId,
                status: 404,
                message: "User or product not found",
              };
            }
          })
        );

        // Handle responses
        const errors = results.filter((result) => result.status !== 200);
        if (errors.length > 0) {
          res.status(400).json({ message: "Some operations failed", errors });
        } else {
          res.json({ message: "All cart items updated successfully" });
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

    // ----------------------- -----------------------
    // ----------------------- Order related operations
    // ----------------------- -----------------------

    // --- add a new product to cart

    // --- add a new product(s) to orders
    // --- add new product(s) to orders
    app.post("/api/v1/addOrders", async (req, res) => {
      const { email, data: products, status } = req.body; // Expecting email, array of products, and status in the request body

      try {
        // Find the user
        const user = await userDb.findOne({ email });

        if (!user) {
          return res.status(404).json({ message: "User not found" });
        }

        // Ensure the orders array exists
        if (!user.orders) {
          user.orders = [];
        }

        let results = [];
        let errors = [];

        for (let product of products) {
          const { quantity: productQuantity } = product;

          // Get the current time
          const orderTime = new Date();

          // Create a new order entry
          const newProduct = {
            ...product,
            quantity: productQuantity,
            status,
            orderTime,
          };
          const result = await userDb.updateOne(
            { email },
            { $push: { orders: newProduct } }
          );

          if (result.matchedCount > 0) {
            results.push({
              productId: product._id,
              message: "New product added to orders",
              result,
            });
          } else {
            errors.push({
              productId: product._id,
              message: "Failed to add new product",
            });
          }
        }

        // Handle responses based on the outcome
        if (errors.length > 0) {
          res.status(400).json({
            message: "Some operations failed",
            results,
            errors,
          });
        } else {
          res.status(200).json({
            message: "All products processed successfully",
            results,
          });
        }
      } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Error processing orders", error });
      }
    });

    //--- modifying items in orders
    app.patch("/api/v1/modifyOrders", async (req, res) => {
      try {
        let { data, email, modifyType } = req.body; // `data` is now an array of products
        if (!Array.isArray(data) || data.length === 0) {
          data = [data];
        }

        const user = await userDb.findOne({ email });
        if (!user) {
          return res.status(404).json({ error: "User not found" });
        }

        const updates = data.map((product) => {
          const { _id: productId, orderTime } = product;

          // Update filter to match both _id and orderTime
          const cartItem = user.orders.find(
            (item) =>
              item._id.toString() === productId &&
              item.orderTime.toISOString() === new Date(orderTime).toISOString()
          );

          if (!cartItem) {
            return {
              productId,
              status: 404,
              message: "Product not found in order list",
            };
          }

          let update = {};

          switch (modifyType) {
            case "cancel":
              update["$set"] = {
                "orders.$[elem].status": "cancelled",
                "orders.$[elem].isCancelled": true,
              };
              break;

            case "packaged":
              update["$set"] = {
                "orders.$[elem].status": "packaged",
              };
              break;

            case "reviewed":
              update["$set"] = {
                "orders.$[elem].status": "reviewed",
                "orders.$[elem].isCancelled": false,
              };
              break;

            default:
              return { productId, status: 400, message: "Invalid modifyType" };
          }

          return {
            filter: {
              email,
              "orders._id": productId,
              "orders.orderTime": new Date(orderTime),
            },
            update,
            arrayFilters: [
              { "elem._id": productId, "elem.orderTime": new Date(orderTime) },
            ],
            productId,
          };
        });

        // Execute all updates
        const results = await Promise.all(
          updates.map(async (operation) => {
            if (operation.status) {
              return operation; // This is an error operation
            }

            const { filter, update, arrayFilters } = operation;
            const result = await userDb.updateOne(filter, update, {
              arrayFilters,
            });

            if (result.matchedCount > 0) {
              return {
                productId: operation.productId,
                status: 200,
                message: "Orders updated successfully",
              };
            } else {
              return {
                productId: operation.productId,
                status: 404,
                message: "User or product not found",
              };
            }
          })
        );

        // Handle responses
        const errors = results.filter((result) => result.status !== 200);
        if (errors.length > 0) {
          res.status(400).json({ message: "Some operations failed", errors });
        } else {
          res.json({ message: "All orders updated successfully" });
        }
      } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Internal Server Error" });
      }
    });

    app.post("/api/v1/addRatings", async (req, res) => {
      const { email, data: product, rating } = req.body; // Expecting email, array of products, and status in the request body

      try {
        // Find the user
        const user = await userDb.findOne({ email });

        if (!user) {
          return res.status(404).json({ message: "User not found" });
        }

        // Ensure the orders array exists
        if (!user.ratings) {
          user.ratings = [];
        }

        let results = [];
        let errors = [];

        console.log({rating});

        // Get the current time
        const orderTime = new Date();

        // Create a new order entry
        const newProduct = {
          ...product,
          rating,
          orderTime,
        };
        const result = await userDb.updateOne(
          { email },
          { $push: { ratings: newProduct } }
        );

        if (result.matchedCount > 0) {
          results.push({
            productId: product._id,
            message: "New product added to rating list",
            result,
          });
        } else {
          errors.push({
            productId: product._id,
            message: "Failed to add new ratings",
          });
        }

        // Handle responses based on the outcome
        if (errors.length > 0) {
          res.status(400).json({
            message: "Some operations failed",
            results,
            errors,
          });
        } else {
          res.status(200).json({
            message: "Ratings added successfully",
            results,
          });
        }
      } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Error processing ratings", error });
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

// --- modifying cart - increase, decrease , delete, order confirmation
/*     app.patch("/api/v1/modifyCart", async (req, res) => {
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

          case "wishlist_false":
            update["$set"] = { "cart.$.wishlist": false };
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
    }); */
