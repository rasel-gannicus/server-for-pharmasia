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
    const productDb = client.db("Pharmasia").collection("products");

    // --- adding new user to database after user register or logged in client site
    app.post("/api/v1/addUserData", async (req, res) => {
      let userData = req.body;

      let role = "";
      if (
        userData?.email == "admin@admin.com" ||
        userData?.email == "admin@pharmasia.com"
      ) {
        role = "admin";
      } else {
        role = "user";
      }
      userData = { ...userData, role };

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

    // --- Updating user data (role or other fields) with PATCH request
    app.patch("/api/v1/updateUser", async (req, res) => {
      const { email, updates } = req.body;

      if (!email || !updates) {
        return res
          .status(400)
          .json({ message: "Email and updates are required." });
      }

      const filter = { email }; // Filter by user's email
      const update = { $set: updates }; // Update only the fields provided in updates

      try {
        const result = await userDb.updateOne(filter, update);

        if (result.matchedCount === 0) {
          return res.status(404).json({ message: "User not found" });
        }

        res.status(200).json({
          message: "User updated successfully",
          result,
        });
      } catch (error) {
        console.error(error);
        res.status(500).json({
          message: "Error updating user data",
          error,
        });
      }
    });

    // --- add a new product to cart
    app.post("/api/v1/addToCart", async (req, res) => {
      const { email, product, status } = req.body; // Expecting email, product data, and status in the request body

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
        if (!user.notifications) {
          user.notifications = [];
        }

        let results = [];
        let errors = [];

        for (let product of products) {
          const { quantity: productQuantity } = product;

          // Get the current time
          const orderTime = new Date();

          // creating a notification when user add a new order
          const newNotification = {
            details:
              "We have received your order. We are now processing this order. ",
            isRead: false,
            createdAt: new Date(), // Add timestamp when the notification is created
          };

          // Create a new order entry
          const newProduct = {
            ...product,
            quantity: productQuantity,
            status,
            orderTime,
          };
          const result = await userDb.updateOne(
            { email },
            { $push: { orders: newProduct, notifications: newNotification } }
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
        console.log(modifyType);

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

            case "shipping":
              update["$set"] = {
                "orders.$[elem].status": "shipping",
                "orders.$[elem].isCancelled": false,
              };
              break;

            case "processing":
              update["$set"] = {
                "orders.$[elem].status": "processing",
                "orders.$[elem].isCancelled": false,
              };
              break;

            case "shipped":
              update["$set"] = {
                "orders.$[elem].status": "shipped",
                "orders.$[elem].isCancelled": false,
              };
              break;

            case "delivered":
              update["$set"] = {
                "orders.$[elem].status": "delivered",
                "orders.$[elem].isCancelled": false,
              };
              break;

            case "newOrder" || "pending":
              update["$set"] = {
                "orders.$[elem].status": "newOrder",
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

        console.log({ rating });

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

    // --- modifying notifications
    app.patch("/api/v1/modifyNotifications", async (req, res) => {
      try {
        const { email, modifyType, productTitle, productImg } = req.body;

        let updateQuery;
        const newNotification = {
          isRead: false,
          createdAt: new Date(), // Add timestamp when the notification is created
        };

        // Use a switch case for modifyType logic
        switch (modifyType) {
          case "read":
            // Set all notifications' isRead to true
            updateQuery = {
              $set: { "notifications.$[].isRead": true },
            };
            break;

          case "processing":
            // Add a new notification for "packaged"
            updateQuery = {
              $push: {
                notifications: {
                  details: "We are processing your order",
                  isRead: false,
                  createdAt: new Date(),
                  productTitle,
                  productImg,
                },
              },
            };
            break;

          case "packaged":
            // Add a new notification for "packaged"
            updateQuery = {
              $push: {
                notifications: {
                  details: "Your product has been packaged",
                  isRead: false,
                  createdAt: new Date(),
                  productTitle,
                  productImg,
                },
              },
            };
            break;

          case "shipping":
            // Add a new notification for "shipping"
            updateQuery = {
              $push: {
                notifications: {
                  details: "We are shipping your order 🚀",
                  isRead: false,
                  createdAt: new Date(),
                  productTitle,
                  productImg,
                },
              },
            };
            break;

          case "shipped":
            // Add a new notification for "shipped"
            updateQuery = {
              $push: {
                notifications: {
                  details: "Your order has been shipped 🚀",
                  isRead: false,
                  createdAt: new Date(),
                  productTitle,
                  productImg,
                },
              },
            };
            break;

          case "delivered":
            // Add a new notification for "shipped"
            updateQuery = {
              $push: {
                notifications: {
                  details:
                    "Your order has been delivered . Don't forget to share your experince ! ",
                  isRead: false,
                  createdAt: new Date(),
                  productTitle,
                  productImg,
                },
              },
            };
            break;

          case "cancelled":
            // Add a new notification for "shipped"
            updateQuery = {
              $push: {
                notifications: {
                  details: "Your order has been Cancelled !",
                  isRead: false,
                  createdAt: new Date(),
                  productTitle,
                  productImg,
                },
              },
            };
            break;

          default:
            return res.status(400).json({ error: "Invalid modifyType" });
        }

        // Find the user and apply the update based on modifyType
        const result = await userDb.updateOne({ email }, updateQuery);

        if (result.matchedCount > 0) {
          // Fetch user data after the update to sort notifications
          const updatedUser = await userDb.findOne({ email });
          if (updatedUser) {
            // Sort notifications by createdAt in descending order (latest first)
            const sortedNotifications = updatedUser.notifications.sort(
              (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
            );

            res.json({
              message: `Notifications modified successfully for modifyType: ${modifyType}`,
              notifications: sortedNotifications,
            });
          } else {
            res.status(404).json({ error: "User not found after update" });
          }
        } else {
          res.status(404).json({ error: "User not found" });
        }
      } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Internal Server Error" });
      }
    });

    // --- getting notifications
    app.get("/api/v1/notifications/:email", async (req, res) => {
      const { email } = req.params;
      try {
        const user = await userDb.findOne({ email });
        if (user) {
          if (!user.notifications) {
            user.notifications = [];
          }

          // Sort notifications by createdAt in descending order (latest first)
          const sortedNotifications = user.notifications.sort(
            (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
          );

          res.status(200).json(sortedNotifications);
        } else {
          res.status(404).json({ message: "User not found" });
        }
      } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Error retrieving user data", error });
      }
    });

    //-- getting all user info
    app.get("/api/v1/allUsers", async (req, res) => {
      const query = {};
      const cursor = userDb.find(query);
      const result = await cursor.toArray();
      res.send(result);
    });

    //-- getting single user info
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

    // ----------------------- -----------------------
    // ----------------------- Product related operations
    // ----------------------- -----------------------

    // --- getting all products
    app.get("/api/v1/allProducts", async (req, res) => {
      const query = {};
      const cursor = productDb.find(query);
      const result = await cursor.toArray();
      res.send(result);
    });

    // --- getting single product with id
    app.get("/api/v1/product/:id", async (req, res) => {
      const { id } = req.params;
      const product = await productDb.findOne({ _id: new ObjectId(id) });
      if (product) {
        res.status(200).json(product);
        return;
      } else {
        res.status(404).json({ message: "Product not found" });
        return;
      }
    });

    // --- adding a new product
    app.post("/api/v1/addProduct", async (req, res) => {
      try {
        const newProduct = {
          Title: req.body.Title,
          Category: req.body.Category,
          Price: req.body.Price,
          Images: req.body.Images,
          Description: req.body.Description,
          Brand: req.body.Brand,
          Flashsale: req.body.Flashsale || false,
          Ratings: req.body.Ratings || 0,
        };

        // Insert the new product into the collection
        const result = await productDb.insertOne(newProduct);

        if (result.acknowledged) {
          res.status(201).send({
            message: "Product added successfully",
            productId: result.insertedId,
          });
        } else {
          res.status(500).send({ message: "Failed to add product" });
        }
      } catch (error) {
        console.error("Error adding product:", error);
        res.status(500).send({ message: "Server error", error });
      }
    });

    // --- updating an existing product
    app.put("/api/v1/editProduct/:id", async (req, res) => {
      const { id } = req.params; // Get the product ID from the request parameters
      console.log("🚀 ~ app.put ~ id:", id);
      try {
        // Create an object with the fields that can be updated
        const updatedProduct = {
          Title: req.body.Title,
          Category: req.body.Category,
          Price: req.body.Price,
          Images: req.body.Images,
          Description: req.body.Description,
          Brand: req.body.Brand,
          Flashsale: req.body.Flashsale || false,
          Ratings: req.body.Ratings || 0,
        };

        // Remove undefined fields from the updatedProduct object to avoid overwriting them as null
        for (let key in updatedProduct) {
          if (updatedProduct[key] === undefined) {
            delete updatedProduct[key];
          }
        }

        // Update the product in the collection using the product ID
        const result = await productDb.updateOne(
          { _id: new ObjectId(id) }, // Match product by ID
          { $set: updatedProduct } // Set the new values for the fields
        );

        if (result.modifiedCount > 0) {
          res.status(200).send({ message: "Product updated successfully" });
        } else if (result.matchedCount > 0) {
          res
            .status(200)
            .send({ message: "No changes detected in the product data" });
        } else {
          res.status(404).send({ message: "Product not found" });
        }
      } catch (error) {
        console.error("Error updating product:", error);
        res.status(500).send({ message: "Server error", error });
      }
    });

    // --- deleting an existing product
    app.delete("/api/v1/deleteProduct/:id", async (req, res) => {
      try {
        const { id } = req.params; // Get the product ID from the request parameters

        // Delete the product from the collection using the product ID
        const result = await productDb.deleteOne({ _id: new ObjectId(id) });

        if (result.deletedCount > 0) {
          res.status(200).send({ message: "Product deleted successfully" });
        } else {
          res.status(404).send({ message: "Product not found" });
        }
      } catch (error) {
        console.error("Error deleting product:", error);
        res.status(500).send({ message: "Server error", error });
      }
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
